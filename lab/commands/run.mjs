// Executes an experiment: one run per harness, every target x case x repeat,
// one raw row per attempt (failures included), then scores the run.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendJsonl, isoNow, readJson, readJsonl, readText, sha256, writeJson, safeSegment } from '../lib/fsutil.mjs';
import { redactEvent, redactPaths } from '../lib/redact.mjs';
import { parseYaml } from '../lib/yaml.mjs';
import { loadPrompt, targetProblems, loadRegistry, loadSuite, paths, renderMessages, resolveExperiment } from '../lib/repo.mjs';
import { costUsd } from '../lib/metrics.mjs';
import { copyTree, snapshotWorkspace, stampDiff, treeHash, treeStamp } from '../lib/workspace.mjs';
import { getAdapter } from '../adapters/index.mjs';
import { extractSvg } from '../evaluators/index.mjs';
import { resolveRunDir, scoreRun } from './score.mjs';
import { modelCheck, normalizeErrorType, processAlive, runLiveness } from '../lib/checks.mjs';

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

// What an agent call must leave alone: the whole repository (inputs, code, docs,
// dashboard, stored evidence), except git internals, installed packages and the
// local scratch folder.
const UNGUARDED_DIRS = new Set(['.git', 'node_modules', '.cache']);

/**
 * Environment overrides for an agent call: drop variables that point back at the
 * repository (npm sets several). A search path keeps its other entries: npm adds
 * <repo>/node_modules/.bin to PATH, and the harness still needs the rest.
 */
export function agentEnv(root, env = process.env) {
  const out = { OLDPWD: undefined };
  const folders = labFolders(root);
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || !mentionsFolder(value, folders)) continue;
    if (/^path$/i.test(key)) out[key] = value.split(path.delimiter).filter((entry) => !mentionsFolder(entry, folders)).join(path.delimiter);
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
  const result = spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore', windowsHide: true, timeout: 30000 });
  return result.status === 0;
}

export function runStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/** Load and check everything an experiment references, before any call is made. */
export function planExperiment(root, file, options = {}) {
  const text = readText(file);
  return planFromExperiment(root, parseYaml(text, path.basename(file)), { ...options, sha: sha256(text), name: path.basename(file) });
}

/** The plan for an experiment object: from a file, or the copy a run recorded (resume). */
export function planFromExperiment(root, experiment, { harness: onlyHarness, models: onlyModels, repeats: repeatOverride, cases: caseOverride, sha = null, name = experiment?.id || 'experiment' } = {}) {
  const file = name;
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
      if (access !== 'edit') throw new Error(`Case ${item.case_id} has a workspace; agent tasks need access: edit, or the agent cannot change any file`);
      if (!fs.existsSync(workspaceDir(suite, item))) throw new Error(`Case ${item.case_id}: workspace folder ${workspaceDir(suite, item)} not found`);
    }
  }
  const repeats = Number(repeatOverride ?? experiment.repeats ?? suite.meta.defaults?.repeats ?? 1);
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error(`repeats must be a positive integer, got ${repeats}`);
  // One run per harness and effort: a run's models share one effort setting, so two
  // efforts of one model are two runs, two configurations, one comparison.
  const chosen = targets.filter((target) => (!onlyHarness || target.harness === onlyHarness) && (!onlyModels || onlyModels.includes(target.model)));
  const adapters = Object.fromEntries(chosen.map((target) => [target.harness, getAdapter(target.harness, root)]));
  const targetIssues = targetProblems(chosen, registry, adapters);
  if (targetIssues.length) throw new Error(`${path.basename(file)}:\n  ${targetIssues.join('\n  ')}`);
  const groups = new Map();
  for (const target of chosen) {
    const key = target.effort === undefined ? target.harness : `${target.harness}@${target.effort}`;
    if (!groups.has(key)) groups.set(key, { harness: target.harness, effort: target.effort, models: [] });
    const group = groups.get(key);
    if (!group.models.includes(target.model)) group.models.push(target.model);
  }
  if (!groups.size) throw new Error(onlyHarness || onlyModels ? `No target matches ${[onlyHarness && `harness "${onlyHarness}"`, onlyModels && `models ${onlyModels.join(', ')}`].filter(Boolean).join(' and ')}` : 'No targets to run');
  // A run records the cases it executed. The full suite is recorded as "all" by omitting the list.
  const recorded = { ...experiment };
  if (caseOverride) recorded.cases = caseOverride;
  if (repeatOverride != null) recorded.repeats = repeats;
  return {
    experiment: recorded,
    experimentSha: sha,
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

/** `effort`: the target's effort (undefined: the registry's; "default": the harness default). */
function modelPlan(plan, adapter, modelKey, effortOverride = undefined) {
  const entry = plan.registry[modelKey];
  const params = entry.params || {};
  const requestedEffort = effortOverride === undefined ? (entry.reasoning_effort ?? null) : effortOverride === 'default' ? null : effortOverride;
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

// Folders at the repository root that the dashboard and `node lab report` write to
// while a run may be going. They hold no hidden check, so the guard skips them.
const DASHBOARD_DIRS = ['boards', 'annotations', 'reports'];

// The data folder is shared by every checkout. The guard watches all of it during an
// agent call: every entry of results/ (a planted file or run folder counts), and every
// file in each run folder, this experiment's open runs included (the runner writes
// nothing during a call). Two things are left out: derived scores/, and a run folder
// whose run.json says another live runner owns it (another worktree's run or resume).
const DATA_KEY = 'data folder: ';

function ownedElsewhere(dir) {
  try {
    const manifest = readJson(path.join(dir, 'run.json'));
    const pid = manifest?.runner?.pid;
    return manifest?.status === 'running' && pid !== process.pid && processAlive(pid);
  } catch {
    return false;
  }
}

function guardStamp(root) {
  const stamp = treeStamp(root, UNGUARDED_DIRS);
  for (const key of [...stamp.keys()]) if (DASHBOARD_DIRS.some((dir) => key.startsWith(`${dir}/`))) stamp.delete(key);
  const elsewhere = new Set();
  const data = paths(root).data;
  const base = data ? path.join(data, 'results') : null;
  if (base && fs.existsSync(base)) {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const rel = `results/${entry.name}`;
      const abs = path.join(base, entry.name);
      if (!entry.isDirectory()) {
        stamp.set(`${DATA_KEY}${rel}`, sha256(fs.readFileSync(abs)));
        continue;
      }
      if (ownedElsewhere(abs)) {
        elsewhere.add(rel);
        continue;
      }
      stamp.set(`${DATA_KEY}${rel}/`, 'folder');
      for (const [key, value] of treeStamp(abs, UNGUARDED_DIRS)) if (!key.startsWith('scores/')) stamp.set(`${DATA_KEY}${rel}/${key}`, value);
    }
  }
  return { stamp, elsewhere };
}

/** The first changed key, leaving out run folders that another runner owned before or after the call. */
function guardDiff(before, after) {
  const skip = new Set([...before.elsewhere, ...after.elsewhere]);
  const keep = (stamp) => new Map([...stamp].filter(([key]) => {
    if (!key.startsWith(DATA_KEY)) return true;
    const rel = key.slice(DATA_KEY.length).split('/').slice(0, 2).join('/');
    return !skip.has(rel);
  }));
  return stampDiff(keep(before.stamp), keep(after.stamp));
}

/** The folders an agent must not name: the repository, and the data folder with every stored run. */
const labFolders = (root) => [root, paths(root).data].filter(Boolean);

const rowKey = (caseId, modelKey, repeat) => `${caseId}|${modelKey}|${repeat}`;

// Each call gets a new folder of its own, directly under the temp folder, and the
// runner deletes it once the evidence is stored. So no call can read the finished
// workspace of an earlier repeat or of another model.
function callFolder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'model-lab-'));
}

function removeFolder(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return !fs.existsSync(dir);
  } catch {
    return false;
  }
}

function heartbeat(session, at = isoNow()) {
  session.manifest.runner.heartbeat_at = at;
  writeJson(path.join(session.runDir, 'run.json'), session.manifest);
}

/** Start one run (one harness), or reopen a stopped one to continue it. */
async function openRun(root, plan, harnessName, modelKeys, { log, resume = null, effort = undefined }) {
  const adapter = getAdapter(harnessName, root);
  const detected = await adapter.detect();
  if (!detected.version) {
    throw new Error(`${harnessName}: CLI not found or "--version" failed. Install it or remove its targets.`);
  }
  const isolated = plan.userConfig === 'isolated';
  const isolationArgs = isolated ? adapter.isolation?.args || [] : [];
  const models = modelKeys.map((key) => modelPlan(plan, adapter, key, effort));
  const session = { adapter, isolationArgs, models, attempts: 0, failures: 0, done: new Set(), halted: null, fenced: true };

  if (resume) {
    if (String(detected.version) !== resume.manifest.harness.version) {
      throw new Error(`${harnessName} is now ${detected.version}; the run used ${resume.manifest.harness.version}. A resumed run must use the same harness version.`);
    }
    session.runId = resume.manifest.run_id;
    session.runDir = resume.runDir;
    session.manifest = resume.manifest;
    for (const row of resume.rows) {
      session.done.add(rowKey(row.case_id, row.model_key, row.repeat));
      session.attempts += 1;
      if (row.error) session.failures += 1;
    }
    const runner = session.manifest.runner || {};
    session.manifest.status = 'running';
    session.manifest.finished_at = null;
    session.manifest.runner = { pid: process.pid, heartbeat_at: isoNow(), resumes: [...(runner.resumes || []), { at: isoNow(), rows_before: resume.rows.length, ...(resume.tornLine ? { dropped_torn_line: true } : {}) }] };
    session.manifest.notes = `${session.manifest.notes || ''} Resumed at ${isoNow()} with ${resume.rows.length} row(s) already written.`.trim();
    heartbeat(session);
    log(`\n${session.runId}\n  resuming: ${resume.rows.length} row(s) kept, ${plan.cases.length * plan.repeats * models.length - resume.rows.length} to go`);
    return session;
  }

  session.runId = `${runStamp()}__${plan.suite.id}__${plan.experiment.id}__${crypto.randomBytes(3).toString('hex')}`;
  session.runDir = path.join(paths(root).results, session.runId);
  session.manifest = {
    run_id: session.runId,
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
        ...(plan.workdirMode === 'isolated' ? { workdir_git_fence: true, workdir_per_call: 'new temp folder, deleted after the call' } : {}),
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
    // The runner process and its last sign of life, so a crashed run shows as stale.
    runner: { pid: process.pid, heartbeat_at: isoNow() },
    notes: `Run by lab ${harnessName}; experiment file sha256 ${plan.experimentSha}.`,
  };
  writeJson(path.join(session.runDir, 'run.json'), session.manifest);
  log(`\n${session.runId}\n  harness ${adapter.name} ${detected.version} · ${models.length} model(s) · ${plan.cases.length} case(s) · ${plan.repeats} repeat(s) · workdir ${plan.workdirMode}`);
  if (isolated && !isolationArgs.length) log(`  note: ${adapter.name} cannot skip the user setup; it loads, and the run records user_config loaded`);
  for (const m of models) {
    if (m.requestedEffort && !m.effort) log(`  note: ${adapter.name} has no effort control; ${m.modelKey} runs at the harness default, not "${m.requestedEffort}"`);
    if (m.notApplied.length) log(`  note: ${adapter.name} does not forward ${m.notApplied.join(', ')} for ${m.modelKey}; harness defaults apply`);
  }
  return session;
}

/** One call: model x case x repeat. Appends its row. Returns true when the guard halts the experiment. */
async function callOne(root, plan, session, testCase, m, repeat, { log, beat = () => heartbeat(session), signal = null }) {
  const { adapter, runDir, runId } = session;
  const messages = renderMessages(plan.prompt.messages, testCase.input);
  const isolatedDir = plan.workdirMode !== 'repo';
  const callCwd = isolatedDir ? callFolder() : root;
  if (isolatedDir) {
    if (testCase.input?.workspace != null) copyTree(workspaceDir(plan.suite, testCase), callCwd);
    session.fenced = fenceWorkdir(callCwd) && session.fenced;
  }
  // An agent that may act must stay in its folder. The guard notices a call that
  // changed the lab's files (inputs, code, stored runs) or named the repository.
  // It is a tripwire, not an OS sandbox: see README "Agent tasks".
  const guarded = isolatedDir && (plan.access === 'edit' || testCase.input?.workspace != null);
  // Every open run of the experiment beats, so none looks stale while it waits its
  // turn. The heartbeat writes run.json, so it comes before the guard's first stamp.
  beat();
  const stampBefore = guarded ? guardStamp(root) : null;
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
      isolated: session.isolationArgs.length > 0,
      access: plan.access,
      ...(guarded ? { env: agentEnv(root) } : {}),
    });
  } catch (error) {
    // An adapter bug becomes an error row; it must not leave the run "running".
    result = { error: { type: 'harness_error', message: `adapter threw: ${error?.message || error}` }, events: [] };
  }
  let halt = false;
  if (guarded) {
    let escape = null;
    const changed = guardDiff(stampBefore, guardStamp(root));
    if (changed?.startsWith(DATA_KEY)) {
      escape = `changed or added ${changed.slice(DATA_KEY.length).replace(/\/$/, '')} in the data folder, where the stored runs are, while it ran; the experiment stops and this run is not scored. That run folder is evidence: compare it with a backup before you trust it`;
      halt = true;
    } else if (changed) {
      escape = `changed ${changed} in the lab repository while it ran; the experiment stops and this run is not scored. Check that file with git diff. If you edited it yourself during the call, this is a false alarm: keep your work and run again. Otherwise restore it (git checkout -- <file>) before the next run`;
      halt = true;
    } else if (mentionsFolder(`${JSON.stringify(result.events ?? [])}\n${result.text ?? ''}`, labFolders(root))) {
      escape = 'worked in the lab repository outside its work folder, where it could read the hidden checks';
    }
    if (escape) result = { ...result, error: { type: 'left_workdir', message: `The agent ${escape}.` } };
  }
  // Ctrl+C in a terminal also stops the harness, so its call fails for no fault of its
  // own. That call is not stored: a resume runs it again. A dashboard stop ("cancel")
  // does not touch the harness, so its call ends on its own and its row is kept, error
  // or not: dropping it would retry a real failure in secret.
  if (!halt && signal?.aborted && signal.reason === 'SIGINT' && result.error && result.error.type !== 'left_workdir') {
    if (isolatedDir) removeFolder(callCwd);
    log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: stopped during the call; not stored, a resume runs it again`);
    return false;
  }
  session.attempts += 1;
  const usage = result.usage || { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null };
  const latency = result.wall_ms ?? null;
  const output = usage.output_tokens;
  const modelChecked = modelCheck(m.harnessModel, result.model_reported);
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
    // A usage limit or sign-in failure gets its own type, so it is not scored as the configuration's failure.
    error: result.error ? { type: normalizeErrorType(result.error), message: redactPaths(String(result.error.message)) } : null,
    metadata: {
      harness_model: m.harnessModel,
      model_reported: result.model_reported ?? null,
      model_check: modelChecked,
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
    // A call that crashed before its row was written may have left a snapshot; it is not this call's.
    fs.rmSync(path.join(runDir, ...base.split('/')), { recursive: true, force: true });
    try {
      const artifact = snapshotWorkspace({ fixtureDir: workspaceDir(plan.suite, testCase), fixtureSha, workDir: callCwd, runDir, base, artifactId: `${row.case_id}__${row.model_key}__r${repeat}__workspace`, createdAt: isoNow() });
      row.artifacts = [...(row.artifacts || []), artifact];
    } catch (error) {
      log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: workspace not stored: ${error.message}`);
    }
  }
  if (isolatedDir) row.metadata.workdir_removed = removeFolder(callCwd);
  appendJsonl(path.join(runDir, 'raw.jsonl'), row);
  for (const event of result.events || []) {
    // Events keep what the call did, not how this machine is set up (lab/lib/redact.mjs).
    appendJsonl(path.join(runDir, 'harness-events.ndjson'), { case_id: row.case_id, model_key: row.model_key, repeat, event: redactEvent(event) });
  }
  session.done.add(rowKey(row.case_id, row.model_key, repeat));
  if (row.error) session.failures += 1;
  heartbeat(session);
  if (modelChecked === 'mismatch') log(`  warning: ${adapter.name} reports model "${result.model_reported}", not "${m.harnessModel}"; the row is marked model_check mismatch`);
  if (isolatedDir && !row.metadata.workdir_removed) log(`  warning: could not delete the call folder ${callCwd}; a process the harness started may still hold it`);
  if (halt) {
    log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: ${row.error.message}`);
    session.halted = 'left_workdir';
    return true;
  }
  const shown = row.error ? `ERROR ${row.error.type}: ${row.error.message.split('\n')[0].slice(0, 120)}` : JSON.stringify(String(row.response.text).slice(0, 60));
  log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: ${shown} · ${latency ?? '?'} ms · ${usage.input_tokens ?? '?'} in / ${usage.output_tokens ?? '?'} out`);
  return false;
}

/** Finish one run: status, harness version at the end, scores. */
async function closeRun(root, plan, session, { log, aborted, halted }) {
  const { manifest, runDir, adapter } = session;
  manifest.finished_at = isoNow();
  if (plan.workdirMode !== 'repo') manifest.harness.settings.workdir_git_fence = session.fenced;
  // A CLI that updates itself during a long run changes the harness under the label.
  const end = await adapter.detect().catch(() => ({ version: null }));
  if (end.version && String(end.version) !== manifest.harness.version) {
    manifest.harness.settings.version_end = String(end.version);
    manifest.notes += ` The harness changed from ${manifest.harness.version} to ${end.version} during the run.`;
    log(`  warning: ${adapter.name} changed from ${manifest.harness.version} to ${end.version} during the run`);
  }
  const stopped = aborted || Boolean(halted);
  manifest.status = stopped || (session.attempts > 0 && session.failures === session.attempts) ? 'failed' : 'completed';
  const runner = manifest.runner || {};
  manifest.runner = { pid: runner.pid ?? process.pid, heartbeat_at: isoNow(), ...(runner.resumes ? { resumes: runner.resumes } : {}), ...(aborted && !halted ? { interrupted: true } : {}) };
  if (aborted && !halted) manifest.notes += ` Interrupted before every row was written. Continue it with: node lab run --resume ${session.runId}`;
  if (halted) {
    manifest.harness.settings.halted = halted;
    manifest.notes += halted === 'left_workdir'
      ? ' Stopped: a file of the lab repository changed during an agent call. Not scored; node lab score skips it unless --force.'
      : ' Stopped: another run of this experiment halted when a file of the lab repository changed during an agent call. Not scored; node lab score skips it unless --force.';
  }
  writeJson(path.join(runDir, 'run.json'), manifest);
  // The changed files may include the hidden checks, so a halted run is not scored.
  const written = halted ? [] : scoreRun(root, runDir, { log });
  log(`\n${session.runId}`);
  for (const item of written) log(`  scored ${path.basename(item.file)}: ${item.passed}/${item.count} passed`);
  log(`  ${manifest.status}: ${session.attempts} attempt(s), ${session.failures} error(s)`);
  return { runId: session.runId, runDir, status: manifest.status, attempts: session.attempts, failures: session.failures, halted: Boolean(halted) };
}

function beatAll(sessions) {
  const at = isoNow();
  for (const session of sessions) heartbeat(session, at);
}

/**
 * Every harness runs in one loop: repeat, then case, then harness, then model. A
 * slow hour, a usage limit or a CLI update then hits all harnesses alike, not
 * only the one whose turn it was. Each harness still writes its own run.
 */
async function execute(root, plan, sessions, { log, signal }) {
  let aborted = false;
  let haltedBy = null;
  outer: for (let repeat = 0; repeat < plan.repeats; repeat += 1) {
    for (const testCase of plan.cases) {
      for (const session of sessions) {
        for (const m of session.models) {
          if (session.done.has(rowKey(testCase.case_id, m.modelKey, repeat))) continue;
          if (signal?.aborted) {
            aborted = true;
            break outer;
          }
          if (await callOne(root, plan, session, testCase, m, repeat, { log, signal, beat: () => beatAll(sessions) })) {
            haltedBy = session;
            break outer;
          }
        }
      }
    }
  }
  // A stop during the last call ends the loop normally. The run is incomplete only
  // when that call was not stored.
  const total = plan.cases.length * plan.repeats;
  if (signal?.aborted && sessions.some((session) => session.done.size < total * session.models.length)) aborted = true;
  const results = [];
  for (const session of sessions) {
    const halted = haltedBy ? (session === haltedBy ? 'left_workdir' : 'experiment_halted') : null;
    results.push(await closeRun(root, plan, session, { log, aborted: aborted || Boolean(haltedBy), halted }));
  }
  return results;
}

function withSigint(log, work) {
  const controller = new AbortController();
  // The dashboard emits SIGINT with "cancel" (lab/cli.mjs); a terminal Ctrl+C gives "SIGINT".
  const onSignal = (source) => {
    log('\nStopping after the current call. The run is kept and marked failed; continue it later with --resume.');
    controller.abort(source === 'cancel' ? 'cancel' : 'SIGINT');
  };
  process.once('SIGINT', onSignal);
  return work(controller.signal).finally(() => process.removeListener('SIGINT', onSignal));
}

export async function runCommand(root, file, options = {}) {
  const log = options.log || console.log;
  if (options.resume) return resumeCommand(root, options.resume, { log, force: options.force, dryRun: options.dryRun });
  const plan = planExperiment(root, file, options);
  const totalCalls = [...plan.groups.values()].reduce((sum, group) => sum + group.models.length, 0) * plan.cases.length * plan.repeats;
  log(`Experiment ${plan.experiment.id}: suite ${plan.suite.id} ${plan.suite.version}, prompt ${plan.prompt.id} v${plan.prompt.version}, ${totalCalls} call(s) in ${plan.groups.size} run(s)`);
  if (options.dryRun) {
    for (const { harness, effort, models } of plan.groups.values()) {
      const adapter = getAdapter(harness, root);
      const flags = plan.userConfig === 'isolated' ? adapter.isolation?.args || [] : [];
      for (const key of models) {
        const m = modelPlan(plan, adapter, key, effort);
        log(`  ${harness}: ${key} → model "${m.harnessModel}", effort ${m.effort ?? 'default'}, user setup ${flags.length ? `skipped (${flags.join(' ')})` : 'loaded'}${plan.access === 'edit' ? `, access edit (${(adapter.edit?.args || []).join(' ') || 'no flags'})` : ''}${m.notApplied.length ? `, not forwarded: ${m.notApplied.join(', ')}` : ''}${plan.registry[key]?.pinned === false ? ', alias (not a pinned snapshot)' : ''}`);
      }
    }
    log('Dry run: nothing was called or written.');
    return [];
  }
  const results = [];
  const sessions = [];
  for (const { harness, effort, models } of plan.groups.values()) {
    try {
      sessions.push(await openRun(root, plan, harness, models, { log, effort }));
    } catch (error) {
      log(`\n${harness}: skipped. ${error.message}`);
      results.push({ harness, status: 'skipped', error: error.message });
    }
  }
  if (!sessions.length) return results;
  return withSigint(log, async (signal) => [...results, ...(await execute(root, plan, sessions, { log, signal }))]);
}

/**
 * Continue a run that stopped before its last row: it crashed (stale) or the user
 * stopped it. The rows it has stay as they are; only the missing ones run, with the
 * same suite, prompt, models and harness version, or the resume is refused.
 */
export async function resumeCommand(root, ref, { log = console.log, force = false, dryRun = false } = {}) {
  const runDir = resolveRunDir(root, ref);
  const manifest = readJson(path.join(runDir, 'run.json'));
  const liveness = runLiveness(manifest);
  if (manifest.harness?.settings?.halted) throw new Error(`${manifest.run_id} was halted by the workdir guard; it cannot be resumed. Start a new run.`);
  if (manifest.status === 'completed') throw new Error(`${manifest.run_id} is completed; nothing to resume.`);
  // A crashed runner's process id can belong to another program by now. Only the owner
  // can tell, so --force overrides "live" too.
  if (liveness === 'live' && !force) {
    throw new Error(`${manifest.run_id} is still running (process ${manifest.runner.pid}, last heartbeat ${manifest.runner.heartbeat_at}). If process ${manifest.runner.pid} is not a lab runner, pass --force.`);
  }
  if (manifest.status === 'running' && liveness === 'unknown' && !force) {
    throw new Error(`${manifest.run_id} says running but has no heartbeat (written before resume existed). If no runner is working on it, pass --force.`);
  }
  if (manifest.status === 'failed' && !manifest.runner?.interrupted && !/Interrupted before every row/.test(manifest.notes || '') && !force) {
    throw new Error(`${manifest.run_id} finished with every call failing; it was not interrupted. Start a new run, or pass --force.`);
  }
  const plan = planFromExperiment(root, manifest.experiment, {
    harness: manifest.harness.name,
    models: manifest.models.map((item) => item.model_key),
    sha: /sha256 ([a-f0-9]{64})/.exec(manifest.notes || '')?.[1] ?? null,
  });
  const differs = [];
  if (plan.suite.sha256 !== manifest.suite.sha256) differs.push(`suite ${plan.suite.id} changed (run ${manifest.suite.version}, now ${plan.suite.version})`);
  if (plan.prompt.sha256 !== manifest.prompt.sha256) differs.push(`prompt ${plan.prompt.id} changed`);
  if (plan.repeats !== manifest.repeats) differs.push(`repeats ${plan.repeats} differ from the run's ${manifest.repeats}`);
  const adapter = getAdapter(manifest.harness.name, root);
  // The run is one group of the experiment: the one whose effort gives the efforts it recorded.
  const sameEffort = (group) => manifest.models.every((item) => group.models.includes(item.model_key) && (modelPlan(plan, adapter, item.model_key, group.effort).effort ?? null) === (item.reasoning_effort ?? null));
  const group = [...plan.groups.values()].find((item) => item.harness === manifest.harness.name && sameEffort(item))
    ?? [...plan.groups.values()].find((item) => item.harness === manifest.harness.name);
  for (const item of manifest.models) {
    const now = modelPlan(plan, adapter, item.model_key, group?.effort);
    if (now.harnessModel !== item.model || (now.effort ?? null) !== (item.reasoning_effort ?? null)) differs.push(`${item.model_key} is now "${now.harnessModel}" at effort ${now.effort ?? 'default'}`);
  }
  if (differs.length) throw new Error(`Cannot resume ${manifest.run_id}; its inputs changed:\n  ${differs.join('\n  ')}\nStart a new run.`);
  // The same check openRun makes, so a dry run never promises a resume that is refused.
  const detected = await adapter.detect();
  if (!detected.version) throw new Error(`${manifest.harness.name}: CLI not found or "--version" failed.`);
  if (String(detected.version) !== manifest.harness.version) {
    throw new Error(`${manifest.harness.name} is now ${detected.version}; the run used ${manifest.harness.version}. A resumed run must use the same harness version.`);
  }
  const rawFile = path.join(runDir, 'raw.jsonl');
  const { rows, problems } = readJsonl(rawFile);
  // A crash in the middle of an append leaves a torn last line with no newline. It was
  // never a record; it is cut off (and the cut recorded), so the next row starts clean.
  // A complete last row without its newline gets the newline, or the next row would join it.
  const text = fs.existsSync(rawFile) ? fs.readFileSync(rawFile, 'utf8') : '';
  let tornLine = false;
  let addNewline = false;
  if (problems.length) {
    const torn = problems.length === 1 && !text.endsWith('\n') && problems[0].line === text.split('\n').length;
    if (!torn) throw new Error(`Cannot resume ${manifest.run_id}: raw.jsonl line ${problems[0].line} is not valid JSON (${problems[0].message}).`);
    tornLine = true;
  } else if (text && !text.endsWith('\n')) {
    addNewline = true;
  }
  if (!dryRun && tornLine) fs.truncateSync(rawFile, Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1), 'utf8'));
  if (!dryRun && addNewline) fs.appendFileSync(rawFile, '\n', 'utf8');
  const total = plan.cases.length * plan.repeats * manifest.models.length;
  if (dryRun) {
    log(`Resume ${manifest.run_id}: ${rows.length} row(s) kept, ${total - rows.length} call(s) to make${tornLine ? '; a torn last line would be dropped' : ''}.`);
    log('Dry run: nothing was called or written.');
    return [];
  }
  const session = await openRun(root, plan, manifest.harness.name, manifest.models.map((item) => item.model_key), { log, effort: group?.effort, resume: { manifest, runDir, rows, tornLine } });
  return withSigint(log, (signal) => execute(root, plan, [session], { log, signal }));
}
