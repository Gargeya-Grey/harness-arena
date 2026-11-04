// Executes an experiment: one run per harness, every target x case x repeat,
// one raw row per attempt (failures included), then scores the run.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendJsonl, isoNow, readText, sha256, writeJson, safeSegment } from '../lib/fsutil.mjs';
import { redactEvent, redactPaths } from '../lib/redact.mjs';
import { parseYaml } from '../lib/yaml.mjs';
import { loadPrompt, loadRegistry, loadSuite, paths, renderMessages, resolveExperiment } from '../lib/repo.mjs';
import { costUsd } from '../lib/metrics.mjs';
import { copyTree, snapshotWorkspace, stampDiff, treeHash, treeStamp } from '../lib/workspace.mjs';
import { getAdapter } from '../adapters/index.mjs';
import { extractSvg } from '../evaluators/index.mjs';
import { scoreRun } from './score.mjs';

const DEFAULT_TIMEOUT_S = 300;
const USER_CONFIG = new Set(['loaded', 'isolated']);
const ACCESS = new Set(['answer', 'edit']);

/** Spellings of a folder that a shell may print: native with /, and the Git Bash, WSL and Cygwin forms of a drive path. */
export function folderSpellings(folder) {
  const plain = path.resolve(folder).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  const drive = /^([a-z]):(\/.*)$/.exec(plain);
  return drive ? [plain, `/${drive[1]}${drive[2]}`, `/mnt/${drive[1]}${drive[2]}`, `/cygdrive/${drive[1]}${drive[2]}`] : [plain];
}

/** Does harness output name one of these folders? Compares with / and any case. */
export function mentionsFolder(text, folders) {
  // JSON text escapes a backslash as two characters; both forms become /.
  const hay = String(text).replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase();
  return folders.some((folder) => folderSpellings(folder).some((needle) => needle.length > 3 && hay.includes(needle)));
}

// What an agent call must leave alone: the lab's inputs, code and stored evidence.
const GUARDED_FOLDERS = ['datasets', 'prompts', 'configs', 'experiments', 'lab', 'schemas', 'results'];

/**
 * Environment overrides for an agent call: drop variables that point back at the
 * repository (npm sets several). A search path keeps its other entries: npm adds
 * <repo>/node_modules/.bin to PATH, and the harness still needs the rest.
 */
export function agentEnv(root, env = process.env) {
  const out = { OLDPWD: undefined };
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || !mentionsFolder(value, [root])) continue;
    if (/^path$/i.test(key)) out[key] = value.split(path.delimiter).filter((entry) => !mentionsFolder(entry, [root])).join(path.delimiter);
    else out[key] = undefined;
  }
  return out;
}

/** The starter workspace of an agent-task case: datasets/<suite>/workspaces/<name>. */
export function workspaceDir(suite, testCase) {
  return path.join(suite.dir, 'workspaces', safeSegment(testCase.input.workspace));
}

// An isolated workdir gets its own empty git repository. Harnesses look upward
// for a repo root (git status, AGENTS.md, CLAUDE.md); without this fence a temp
// folder inside a home folder that is a git repo leaks that repo into the prompt.
export function fenceWorkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const result = spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore', windowsHide: true });
  return result.status === 0;
}

export function runStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/** Load and check everything an experiment references, before any call is made. */
export function planExperiment(root, file, { harness: onlyHarness, models: onlyModels, repeats: repeatOverride, cases: caseOverride } = {}) {
  const text = readText(file);
  const experiment = parseYaml(text, path.basename(file));
  const registry = loadRegistry(root);
  const { targets, problems } = resolveExperiment(experiment, registry);
  const userConfig = experiment.user_config ?? 'loaded';
  if (!USER_CONFIG.has(userConfig)) problems.push(`user_config must be "loaded" or "isolated", got "${userConfig}"`);
  const access = experiment.access ?? 'answer';
  if (!ACCESS.has(access)) problems.push(`access must be "answer" or "edit", got "${access}"`);
  // An agent with edit flags acts without asking; it never runs in the repository itself.
  if (access === 'edit' && experiment.workdir === 'repo') problems.push('access "edit" needs workdir: isolated; an agent never edits inside this repository');
  if (problems.length) throw new Error(`${path.basename(file)}:\n  ${problems.join('\n  ')}`);
  const suite = loadSuite(root, experiment.suite);
  const prompt = loadPrompt(root, experiment.prompt, experiment.prompt_version);
  const caseIds = caseOverride || experiment.cases || null;
  const known = new Map(suite.cases.map((item) => [item.case_id, item]));
  const unknown = (caseIds || []).filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Cases not in suite ${suite.id}: ${unknown.join(', ')}`);
  const cases = caseIds ? caseIds.map((id) => known.get(id)) : suite.cases;
  for (const item of cases) {
    const missing = prompt.variables.filter((name) => !(name in (item.input || {})));
    if (missing.length) throw new Error(`Case ${item.case_id} lacks prompt variable(s): ${missing.join(', ')}`);
    if (item.input?.workspace != null) {
      if (experiment.workdir === 'repo') throw new Error(`Case ${item.case_id} has a workspace; agent tasks need workdir: isolated`);
      if (!fs.existsSync(workspaceDir(suite, item))) throw new Error(`Case ${item.case_id}: workspace folder ${workspaceDir(suite, item)} not found`);
    }
  }
  const repeats = Number(repeatOverride ?? experiment.repeats ?? suite.meta.defaults?.repeats ?? 1);
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error(`repeats must be a positive integer, got ${repeats}`);
  const groups = new Map();
  for (const target of targets) {
    if (onlyHarness && target.harness !== onlyHarness) continue;
    if (onlyModels && !onlyModels.includes(target.model)) continue;
    getAdapter(target.harness, root);
    if (!groups.has(target.harness)) groups.set(target.harness, []);
    if (!groups.get(target.harness).includes(target.model)) groups.get(target.harness).push(target.model);
  }
  if (!groups.size) throw new Error(onlyHarness || onlyModels ? `No target matches ${[onlyHarness && `harness "${onlyHarness}"`, onlyModels && `models ${onlyModels.join(', ')}`].filter(Boolean).join(' and ')}` : 'No targets to run');
  // A run records the cases it executed. The full suite is recorded as "all" by omitting the list.
  const recorded = { ...experiment };
  if (caseOverride) recorded.cases = caseOverride;
  if (repeatOverride != null) recorded.repeats = repeats;
  return {
    experiment: recorded,
    experimentSha: sha256(text),
    registry,
    suite,
    prompt,
    cases,
    repeats,
    groups,
    timeoutMs: Number(experiment.timeout_s ?? DEFAULT_TIMEOUT_S) * 1000,
    workdirMode: experiment.workdir === 'repo' ? 'repo' : 'isolated',
    persist: Boolean(experiment.persist_sessions),
    userConfig,
    access,
    maxTurns: experiment.max_turns ?? null,
    artifact: suite.meta.artifact || experiment.artifact || null,
  };
}

function modelPlan(plan, adapter, modelKey) {
  const entry = plan.registry[modelKey];
  const params = entry.params || {};
  const requestedEffort = entry.reasoning_effort ?? null;
  const effort = adapter.supports_effort ? requestedEffort : null;
  const applied = adapter.applied({ params, effort });
  const notApplied = Object.keys(params).filter((key) => !(key in applied));
  return {
    modelKey,
    entry,
    harnessModel: entry.harness_models?.[adapter.name] ?? entry.model,
    effort,
    requestedEffort,
    params,
    applied,
    notApplied,
  };
}

function writeArtifact(runDir, kind, row, text, harness) {
  if (kind !== 'svg') return undefined;
  const svg = extractSvg(text);
  if (!svg) return [];
  const rel = `artifacts/${row.case_id}/${row.model_key}__${harness}/r${row.repeat}/output.svg`;
  const file = path.join(runDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg, 'utf8');
  return [{ artifact_id: `${row.case_id}__${row.model_key}__r${row.repeat}__raw`, role: 'raw', mime: 'image/svg+xml', path: rel, sha256: sha256(svg), derived: false, created_at: isoNow() }];
}

async function runHarness(root, plan, harnessName, modelKeys, { log, signal }) {
  const adapter = getAdapter(harnessName, root);
  const detected = await adapter.detect();
  if (!detected.version) {
    throw new Error(`${harnessName}: CLI not found or "--version" failed. Install it or remove its targets.`);
  }
  const isolated = plan.userConfig === 'isolated';
  const isolationArgs = isolated ? adapter.isolation?.args || [] : [];
  const models = modelKeys.map((key) => modelPlan(plan, adapter, key));
  const runId = `${runStamp()}__${plan.suite.id}__${plan.experiment.id}__${crypto.randomBytes(3).toString('hex')}`;
  const runDir = path.join(paths(root).results, runId);
  const cwd = plan.workdirMode === 'repo' ? root : path.join(os.tmpdir(), 'model-lab', runId);
  let fenced = false;
  if (plan.workdirMode === 'repo') fs.mkdirSync(cwd, { recursive: true });
  else fenced = fenceWorkdir(cwd);

  const manifest = {
    run_id: runId,
    created_at: isoNow(),
    finished_at: null,
    status: 'running',
    suite: { id: plan.suite.id, version: plan.suite.version, sha256: plan.suite.sha256 },
    prompt: { id: plan.prompt.id, version: plan.prompt.version, sha256: plan.prompt.sha256 },
    experiment: plan.experiment,
    models: models.map((m) => ({
      model_key: m.modelKey,
      provider: m.entry.provider,
      model: m.harnessModel,
      params: m.applied,
      context_window: m.entry.context_window ?? null,
      reasoning_effort: m.effort,
      pricing: m.entry.pricing || {},
    })),
    repeats: plan.repeats,
    evaluators: plan.experiment.evaluators || [],
    harness: {
      name: adapter.name,
      version: String(detected.version),
      entrypoint: adapter.entrypoint,
      access_method: adapter.access_method,
      platform: process.platform,
      session_id: null,
      settings: {
        workdir: plan.workdirMode,
        ...(plan.workdirMode === 'isolated' ? { workdir_git_fence: fenced } : {}),
        timeout_s: plan.timeoutMs / 1000,
        persist_sessions: plan.persist,
        // answer: the harness replies in text. edit: it may edit files and run commands in its folder.
        access: plan.access,
        ...(plan.access === 'edit' ? { access_flags: adapter.edit?.args || [], access_note: adapter.edit?.note || 'This harness has no edit flags; it runs with its defaults.' } : {}),
        // Did the harness load the user's own setup (instructions, skills, MCP servers)?
        // "isolated" lists the exact flags that kept it out; no flags means it loaded.
        user_config: isolationArgs.length ? 'isolated' : 'loaded',
        ...(isolated ? { user_config_requested: 'isolated', user_config_flags: isolationArgs, user_config_note: adapter.isolation?.note || '' } : {}),
        ...(plan.maxTurns ? { max_turns: plan.maxTurns } : {}),
      },
    },
    notes: `Run by lab ${harnessName}; experiment file sha256 ${plan.experimentSha}.`,
  };
  writeJson(path.join(runDir, 'run.json'), manifest);
  log(`\n${runId}\n  harness ${adapter.name} ${detected.version} · ${models.length} model(s) · ${plan.cases.length} case(s) · ${plan.repeats} repeat(s) · workdir ${plan.workdirMode}`);
  if (isolated && !isolationArgs.length) log(`  note: ${adapter.name} cannot skip the user setup; it loads, and the run records user_config loaded`);
  for (const m of models) {
    if (m.requestedEffort && !m.effort) log(`  note: ${adapter.name} has no effort control; ${m.modelKey} runs at the harness default, not "${m.requestedEffort}"`);
    if (m.notApplied.length) log(`  note: ${adapter.name} does not forward ${m.notApplied.join(', ')} for ${m.modelKey}; harness defaults apply`);
  }

  let attempts = 0;
  let failures = 0;
  let aborted = false;
  let halted = false;
  // Repeat-major order spreads each model's calls over time, so a slow minute hurts all models alike.
  outer: for (let repeat = 0; repeat < plan.repeats; repeat += 1) {
    for (const testCase of plan.cases) {
      for (const m of models) {
        if (signal?.aborted) {
          aborted = true;
          break outer;
        }
        const messages = renderMessages(plan.prompt.messages, testCase.input);
        // Every call gets its own fenced folder, so files one call writes never reach another repeat or model.
        let callCwd = cwd;
        if (plan.workdirMode !== 'repo') {
          callCwd = path.join(cwd, safeSegment(testCase.case_id), safeSegment(m.modelKey), `r${repeat}`);
          if (testCase.input?.workspace != null) copyTree(workspaceDir(plan.suite, testCase), callCwd);
          fenced = fenceWorkdir(callCwd) && fenced;
        }
        // An agent that may act must stay in its folder. The guard notices a call that
        // changed the lab's files (inputs, code, stored runs) or named the repository.
        // It is a tripwire, not an OS sandbox: see README "Agent tasks".
        const guarded = plan.workdirMode !== 'repo' && (plan.access === 'edit' || testCase.input?.workspace != null);
        // The current run folder is guarded too: the runner writes nothing there during a call.
        const stampBefore = guarded ? treeStamp(root, GUARDED_FOLDERS) : null;
        const fixtureSha = testCase.input?.workspace != null ? treeHash(workspaceDir(plan.suite, testCase)) : null;
        const startedAt = isoNow();
        let result;
        try {
          result = await adapter.call({
            model: m.harnessModel,
            messages,
            params: m.params,
            effort: m.effort,
            cwd: callCwd,
            timeoutMs: plan.timeoutMs,
            persist: plan.persist,
            maxTurns: plan.maxTurns,
            isolated: isolationArgs.length > 0,
            access: plan.access,
            ...(guarded ? { env: agentEnv(root) } : {}),
          });
        } catch (error) {
          // An adapter bug becomes an error row; it must not leave the run "running".
          result = { error: { type: 'harness_error', message: `adapter threw: ${error?.message || error}` }, events: [] };
        }
        attempts += 1;
        let halt = false;
        if (guarded) {
          let escape = null;
          const changed = stampDiff(stampBefore, treeStamp(root, GUARDED_FOLDERS));
          if (changed) {
            escape = `changed ${changed} in the lab repository; the experiment stops and this run is not scored. Restore the repository (git status, git checkout) before the next run`;
            halt = true;
          } else if (mentionsFolder(`${JSON.stringify(result.events ?? [])}\n${result.text ?? ''}`, [root])) {
            escape = 'worked in the lab repository outside its work folder, where it could read the hidden checks';
          }
          if (escape) result = { ...result, error: { type: 'left_workdir', message: `The agent ${escape}.` } };
        }
        const usage = result.usage || { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null };
        const latency = result.wall_ms ?? null;
        const output = usage.output_tokens;
        const row = {
          run_id: runId,
          case_id: testCase.case_id,
          model_key: m.modelKey,
          repeat,
          started_at: startedAt,
          latency_ms: latency,
          tokens_per_second: typeof output === 'number' && latency ? Number((output / (latency / 1000)).toFixed(4)) : null,
          tool_calls: result.tool_calls ?? 0,
          skills_used: (result.skills_used ?? []).map((name) => redactPaths(name)),
          request: {
            prompt_id: plan.prompt.id,
            prompt_version: plan.prompt.version,
            messages,
            system_prompt: null,
            params: m.applied,
          },
          response: { text: result.error ? null : redactPaths(result.text ?? null), finish_reason: result.finish_reason ?? null },
          usage,
          cost_usd: result.error ? null : costUsd(usage, m.entry.pricing),
          error: result.error ? { type: String(result.error.type), message: redactPaths(String(result.error.message)) } : null,
          metadata: {
            harness_model: m.harnessModel,
            model_reported: result.model_reported ?? null,
            effort_requested: m.requestedEffort,
            effort_reported: result.effort_reported ?? null,
            params_not_applied: m.notApplied,
            harness_session_id: result.session_id ?? null,
            harness_duration_ms: result.harness_duration_ms ?? null,
            model_request_duration_ms: result.model_request_duration_ms ?? null,
            model_tokens_per_second:
              typeof output === 'number' && result.model_request_duration_ms ? Number((output / (result.model_request_duration_ms / 1000)).toFixed(4)) : null,
            turn_count: result.turn_count ?? null,
            harness_reported_cost_usd: result.harness_cost_usd ?? null,
            system_prompt_injected: true,
            workdir: plan.workdirMode,
            ...(result.extra && Object.keys(result.extra).length ? { harness_extra: result.extra } : {}),
          },
        };
        if (!result.error && plan.artifact) {
          const artifacts = writeArtifact(runDir, plan.artifact, row, redactPaths(result.text), adapter.name);
          if (artifacts) row.artifacts = artifacts;
        }
        if (testCase.input?.workspace != null) {
          // The agent's final workspace is evidence, kept even when the call failed or timed
          // out: the evaluator rebuilds it from this alone.
          const base = `artifacts/${safeSegment(row.case_id)}/${safeSegment(row.model_key)}__${safeSegment(adapter.name)}/r${repeat}/workspace`;
          try {
            const artifact = snapshotWorkspace({ fixtureDir: workspaceDir(plan.suite, testCase), fixtureSha, workDir: callCwd, runDir, base, artifactId: `${row.case_id}__${row.model_key}__r${repeat}__workspace`, createdAt: isoNow() });
            row.artifacts = [...(row.artifacts || []), artifact];
          } catch (error) {
            log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: workspace not stored: ${error.message}`);
          }
        }
        appendJsonl(path.join(runDir, 'raw.jsonl'), row);
        for (const event of result.events || []) {
          // Events keep what the call did, not how this machine is set up (lab/lib/redact.mjs).
          appendJsonl(path.join(runDir, 'harness-events.ndjson'), { case_id: row.case_id, model_key: row.model_key, repeat, event: redactEvent(event) });
        }
        if (row.error) failures += 1;
        if (halt) {
          log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: ${row.error.message}`);
          aborted = true;
          halted = true;
          break outer;
        }
        const shown = row.error ? `ERROR ${row.error.type}: ${row.error.message.split('\n')[0].slice(0, 120)}` : JSON.stringify(String(row.response.text).slice(0, 60));
        log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: ${shown} · ${latency ?? '?'} ms · ${usage.input_tokens ?? '?'} in / ${usage.output_tokens ?? '?'} out`);
      }
    }
  }

  manifest.finished_at = isoNow();
  if (plan.workdirMode !== 'repo') manifest.harness.settings.workdir_git_fence = fenced;
  manifest.status = aborted || (attempts > 0 && failures === attempts) ? 'failed' : 'completed';
  if (aborted) manifest.notes += ' Interrupted before every row was written.';
  if (halted) manifest.notes += ' Stopped: an agent changed files of the lab repository. Not scored; restore the repository, then run node lab score.';
  writeJson(path.join(runDir, 'run.json'), manifest);
  // The changed files may include the hidden checks, so a halted run is not scored.
  const written = halted ? [] : scoreRun(root, runDir, { log });
  for (const item of written) log(`  scored ${path.basename(item.file)}: ${item.passed}/${item.count} passed`);
  log(`  ${manifest.status}: ${attempts} attempt(s), ${failures} error(s)`);
  return { runId, runDir, status: manifest.status, attempts, failures, halted };
}

export async function runCommand(root, file, options = {}) {
  const log = options.log || console.log;
  const plan = planExperiment(root, file, options);
  const totalCalls = [...plan.groups.values()].reduce((sum, models) => sum + models.length, 0) * plan.cases.length * plan.repeats;
  log(`Experiment ${plan.experiment.id}: suite ${plan.suite.id} ${plan.suite.version}, prompt ${plan.prompt.id} v${plan.prompt.version}, ${totalCalls} call(s) across ${plan.groups.size} harness(es)`);
  if (options.dryRun) {
    for (const [harness, models] of plan.groups) {
      const adapter = getAdapter(harness, root);
      const flags = plan.userConfig === 'isolated' ? adapter.isolation?.args || [] : [];
      for (const key of models) {
        const m = modelPlan(plan, adapter, key);
        log(`  ${harness}: ${key} → model "${m.harnessModel}", effort ${m.effort ?? 'default'}, user setup ${flags.length ? `skipped (${flags.join(' ')})` : 'loaded'}${plan.access === 'edit' ? `, access edit (${(adapter.edit?.args || []).join(' ') || 'no flags'})` : ''}${m.notApplied.length ? `, not forwarded: ${m.notApplied.join(', ')}` : ''}`);
      }
    }
    log('Dry run: nothing was called or written.');
    return [];
  }
  const controller = new AbortController();
  const onSignal = () => {
    log('\nStopping after the current call. The run is kept and marked failed.');
    controller.abort();
  };
  process.once('SIGINT', onSignal);
  const results = [];
  try {
    for (const [harness, models] of plan.groups) {
      if (controller.signal.aborted || results.some((item) => item.halted)) break;
      try {
        results.push(await runHarness(root, plan, harness, models, { log, signal: controller.signal }));
      } catch (error) {
        log(`\n${harness}: skipped. ${error.message}`);
        results.push({ harness, status: 'skipped', error: error.message });
      }
    }
  } finally {
    process.removeListener('SIGINT', onSignal);
  }
  return results;
}
