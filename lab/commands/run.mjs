// Executes an experiment: one run per harness, every target x case x repeat,
// one raw row per attempt (failures included), then scores the run.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isoNow, readJson, readJsonl, readText, sha256, safeSegment } from '../lib/fsutil.mjs';
import { redactEvent, redactPaths } from '../lib/redact.mjs';
import { parseYaml } from '../lib/yaml.mjs';
import { effectiveEffort, requiresExplicitEffort, loadPrompt, mainCheckout, targetProblems, loadRegistry, loadSuite, paths, renderMessages, resolveExperiment, runDirs } from '../lib/repo.mjs';
import { costUsd } from '../lib/metrics.mjs';
import { copyTree, snapshotWorkspace, stampDiff, treeHash, treeStamp } from '../lib/workspace.mjs';
import { getAdapter } from '../adapters/index.mjs';
import { extractSvg } from '../evaluators/index.mjs';
import { resolveRunDir, scoreRun } from './score.mjs';
import { errorClass, modelCheck, normalizeErrorType, runLiveness } from '../lib/checks.mjs';
import { LOCK_FILE, storeFolders, takeLocks } from '../lib/lock.mjs';
import { startProcessWatch } from '../lib/procwatch.mjs';
import { appendRunFile, own, runPath, writeRunFile } from '../lib/runwrite.mjs';
import { appendEntry, callFiles, closeEntry, ensureLedger, eventsState, ledgerBytes, ledgerPath, lineSha, loadLedger, manifestCore, restoreLedger, rowLine, rowLines, trustRun } from '../lib/ledger.mjs';

const DEFAULT_TIMEOUT_S = 0;
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
  fs.mkdirSync(dir, { recursive: true }); // not a run folder: the call folder
  const result = spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore', windowsHide: true, timeout: 30000 });
  return result.status === 0;
}

/**
 * What a run records about its access: the edit flags of an `access: edit` run, or the env
 * vars that turn a harness's tools off for an `access: answer` run. A resume compares it.
 */
export function accessSettings(adapter, access) {
  if (access === 'edit') return { access_flags: adapter.edit?.args || [], access_note: adapter.edit?.note || 'This harness has no edit flags; it runs with its defaults.' };
  if (adapter.answer) return { access_flags: Object.entries(adapter.answer.env).map(([key, value]) => `${key}=${value}`), access_note: adapter.answer.note };
  return {};
}

export function runStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/** Load and check everything an experiment references, before any call is made. */
export function planExperiment(root, file, options = {}) {
  const text = readText(file);
  return planFromExperiment(root, parseYaml(text, path.basename(file)), { ...options, requireExplicitEffort: requiresExplicitEffort(root), sha: sha256(text), name: path.basename(file) });
}

/** The plan for an experiment object: from a file, or the copy a run recorded (resume). */
export function planFromExperiment(root, experiment, { harness: onlyHarness, models: onlyModels, repeats: repeatOverride, cases: caseOverride, effort: effortOverride, requireExplicitEffort = false, sha = null, name = experiment?.id || 'experiment' } = {}) {
  const file = name;
  const registry = loadRegistry(root);
  const { targets, problems } = resolveExperiment(experiment, registry, { requireExplicitEffort });
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
  const selected = targets.filter((target) => (!onlyHarness || target.harness === onlyHarness) && (!onlyModels || onlyModels.includes(target.model)));
  const chosen = effortOverride === undefined ? selected : [...new Map(selected.map((target) => [`${target.model}|${target.harness}`, { ...target, effort: effortOverride }])).values()];
  if (effortOverride !== undefined) {
    if (typeof effortOverride !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/.test(effortOverride) || effortOverride === 'default') throw new Error('Choose an explicit supported effort level');
    for (const target of chosen) {
      const levels = registry[target.model]?.effort_levels;
      const unavailable = !getAdapter(target.harness, root).supports_effort || (Array.isArray(levels) && levels.length === 0);
      if (effortOverride === 'unavailable' ? !unavailable : !Array.isArray(levels) || !levels.includes(effortOverride)) throw new Error(`${target.model}: effort ${effortOverride} is not a verified supported level`);
    }
  }
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
  if (effortOverride !== undefined) {
    recorded.targets = chosen.map(({model, harness, effort, label}) => ({model, harness, effort, ...(label ? {label} : {})}));
    recorded.effort_policy = 'explicit';
    delete recorded.models;
    delete recorded.effort;
  }
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
  const recordedEffort = effectiveEffort({ effort: effortOverride }, entry, adapter);
  const effort = recordedEffort === 'unavailable' ? null : recordedEffort;
  const applied = adapter.applied({ params, effort });
  const notApplied = Object.keys(params).filter((key) => !(key in applied));
  return {
    modelKey,
    entry,
    harnessModel: entry.harness_models?.[adapter.name] ?? entry.model,
    effort,
    recordedEffort,
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
  writeRunFile(runDir, rel, svg);
  return [{ artifact_id: `${row.case_id}__${row.model_key}__r${row.repeat}__raw`, role: 'raw', mime: 'image/svg+xml', path: rel, sha256: sha256(svg), derived: false, created_at: isoNow() }];
}

// Folders at the repository root that the dashboard and `node lab report` write to
// while a run may be going. They hold no hidden check, so the guard skips them.
const DASHBOARD_DIRS = ['boards', 'annotations', 'reports'];

// The stores hold every stored run. `node lab run` holds the store lock (lab/lib/lock.mjs),
// so during an agent call nothing else writes there, and the runner itself writes
// nothing between the two stamps. So the guard watches everything the lab reads from a
// store, with no skip list: every entry of each results/ folder (runs, rows, scores,
// folders of any name, links, the read-only bit), the real path of each store folder, the
// top level of the data folder (the lock file included), and both lab.local.yaml files,
// which name the data folder. Only <data>/annotations is left out: the dashboard saves
// human ratings at any time.
const DATA_KEY = 'data folder: ';
const STORE_KEY = 'store: ';
const NO_SKIP = new Set();

/**
 * What the guard watches, fixed once per run before any call, so an agent cannot point
 * the guard at another folder (a changed LAB_DATA or lab.local.yaml).
 */
export function guardScope(root) {
  const { data, resultsDirs } = paths(root);
  const main = mainCheckout(root);
  const ledger = ledgerPath(root);
  // The guard stamps what is inside a store folder, so a store that is a link (a junction
  // or a symbolic link) cannot be watched: it is refused before any call.
  for (const dir of [data, ...resultsDirs, path.dirname(ledger)].filter(Boolean)) {
    if (entryKind(dir).startsWith('link:')) throw new Error(`${dir} is a link (a junction or a symbolic link); the workdir guard cannot watch through it. Point data_dir at its real folder, or make it a plain folder.`);
  }
  return {
    root,
    data,
    results: resultsDirs,
    configs: [...new Set([root, main].filter(Boolean).map((dir) => path.join(dir, 'lab.local.yaml')))],
    ledger,
    ledgerDir: fs.realpathSync.native(path.dirname(ledger)),
  };
}

/** The folders an agent must not name, fixed with the guard scope. */
const scopeFolders = (scope) => [scope.root, scope.data].filter(Boolean);

/** One ledger entry of this run, written only into the ledger the run started with. */
function record(plan, entry) {
  appendEntry(plan.guard.ledger, entry, { realDir: plan.guard.ledgerDir });
}

function entryKind(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return `link:${fs.readlinkSync(file)}`;
    if (stat.isDirectory()) return `folder real:${fs.realpathSync.native(file)}`;
    return stat.isFile() ? 'file' : 'special';
  } catch (error) {
    return error.code === 'ENOENT' ? 'absent' : `unreadable:${error.code}`;
  }
}

function guardStamp(scope) {
  const { root, data } = scope;
  const stamp = treeStamp(root, UNGUARDED_DIRS);
  const localData = data && path.relative(root, data).replace(/\\/g, '/');
  // results/ is stamped below in full; the dashboard folders are not watched.
  for (const key of [...stamp.keys()]) if ([...DASHBOARD_DIRS, 'results', ...(localData && !localData.startsWith('..') ? [localData] : [])].some((dir) => key === dir || key.startsWith(`${dir}/`))) stamp.delete(key);
  for (const file of scope.configs) {
    const kind = entryKind(file);
    stamp.set(`config: ${file}`, kind === 'file' ? `file ${sha256(fs.readFileSync(file))}` : kind);
  }
  // The ledger (its read-only bit too: a ledger made read-only could not be restored) and,
  // beside it, the ledger folder's lock.
  for (const [label, file] of [['ledger', scope.ledger], ['ledger lock', path.join(path.dirname(scope.ledger), LOCK_FILE)]]) {
    const kind = entryKind(file);
    stamp.set(`${label}: ${file}`, kind === 'file' ? `file ${sha256(fs.readFileSync(file))} ${fs.statSync(file).mode & 0o200 ? 'writable' : 'read-only'}` : kind);
  }
  if (data) {
    stamp.set(`${DATA_KEY}.`, entryKind(data));
    if (fs.existsSync(data)) {
      for (const entry of fs.readdirSync(data).sort()) {
        if (DASHBOARD_DIRS.includes(entry)) continue;
        const file = path.join(data, entry);
        const kind = entryKind(file);
        stamp.set(`${DATA_KEY}${entry}`, kind === 'file' ? `file ${sha256(fs.readFileSync(file))}` : kind);
      }
    }
  }
  for (const dir of scope.results) {
    const label = data && dir === path.join(data, 'results') ? `${DATA_KEY}results` : `${STORE_KEY}results`;
    const kind = entryKind(dir);
    stamp.set(`${label}/.`, kind);
    if (!kind.startsWith('folder')) continue;
    for (const [key, value] of treeStamp(dir, NO_SKIP)) stamp.set(`${label}/${key}`, value);
  }
  return stamp;
}

/** The stamp, or the reason it could not be taken: an unreadable lab folder halts like a change. */
function tryGuardStamp(scope) {
  try {
    return { stamp: guardStamp(scope) };
  } catch (error) {
    return { error: `${error.code || 'error'} ${error.message}` };
  }
}

/**
 * The runner's own files in a run folder: an agent may have made one read-only. That is
 * a change the guard halts on; the runner still writes its row and closes the run.
 */
const manifestText = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

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
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); // not a run folder: the call folder
    return !fs.existsSync(dir);
  } catch {
    return false;
  }
}

function heartbeat(session, at = isoNow()) {
  session.manifest.runner.heartbeat_at = at;
  writeRunFile(session.runDir, 'run.json', manifestText(session.manifest));
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
  const session = { adapter, isolationArgs, models, attempts: 0, failures: 0, incomplete: 0, done: new Set(), halted: null, fenced: true };

  if (resume) {
    if (String(detected.version) !== resume.manifest.harness.version) {
      throw new Error(`${harnessName} is now ${detected.version}; the run used ${resume.manifest.harness.version}. A resumed run must use the same harness version.`);
    }
    session.runId = resume.manifest.run_id;
    session.runDir = resume.runDir;
    session.manifest = resume.manifest;
    session.recorded = resume.recorded ?? {};
    for (const row of resume.rows) {
      session.done.add(rowKey(row.case_id, row.model_key, row.repeat));
      session.attempts += 1;
      if (row.error) session.failures += 1;
      if (errorClass(row.error) === 'incomplete') session.incomplete += 1;
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
  fs.mkdirSync(session.runDir, { recursive: true }); // not a run file: makes the new run folder, which runPath checks on every write
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
      reasoning_effort: m.recordedEffort,
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
        ...accessSettings(adapter, plan.access),
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
  writeRunFile(session.runDir, 'run.json', manifestText(session.manifest));
  record(plan, { kind: 'open', run_id: session.runId, core: manifestCore(session.manifest) });
  session.recorded = {};
  log(`\n${session.runId}\n  harness ${adapter.name} ${detected.version} · ${models.length} model(s) · ${plan.cases.length} case(s) · ${plan.repeats} repeat(s) · workdir ${plan.workdirMode}`);
  if (isolated && !isolationArgs.length) log(`  note: ${adapter.name} cannot skip the user setup; it loads, and the run records user_config loaded`);
  for (const m of models) {
    if (m.recordedEffort === 'unavailable') log(`  note: effort control is unavailable for ${m.modelKey} through ${adapter.name}; no effort flag is sent`);
    else if (m.requestedEffort && !m.effort) log(`  note: ${adapter.name} has no effort control; ${m.modelKey} runs at the harness default, not "${m.requestedEffort}"`);
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
  const stampBefore = guarded ? tryGuardStamp(plan.guard) : null;
  // The ledger as it is before the call: a halt puts it back to exactly this.
  const ledgerBefore = guarded ? ledgerBytes(plan.guard.ledger) : null;
  if (stampBefore?.error) {
    // Nothing was called yet, so no agent is to blame: stop before spending the call.
    if (isolatedDir) removeFolder(callCwd);
    log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: the workdir guard cannot read the lab folders before the call (${redactPaths(stampBefore.error)}); no call was made and the experiment stops. Fix that folder, then resume the run.`);
    session.halted = 'guard_unreadable';
    return true;
  }
  // No process the call starts may outlive it (lab/lib/procwatch.mjs). A watch that
  // cannot start makes no call, as a guard that cannot read the folders makes none.
  let watch = null;
  if (guarded) {
    try {
      watch = await startProcessWatch();
    } catch (error) {
      if (isolatedDir) removeFolder(callCwd);
      log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: the process watch cannot start (${redactPaths(error.message)}); no call was made and the experiment stops. Resume the run when it works.`);
      session.halted = 'guard_unreadable';
      return true;
    }
  }
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
    // First end what the call left running, then stamp: whatever those processes wrote
    // before they ended is in the stamp after.
    const procs = await watch.finish();
    if (procs.ended.length) log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: ended ${procs.ended.length} process(es) the call left running (${procs.ended.join(', ')})`);
    if (procs.error) escape = `got past the process watch (${redactPaths(procs.error)}); the experiment stops and this run is not scored. A process it started may still be running: look for one before you trust the stored runs`;
    else if (procs.survivors.length) escape = `left process(es) running that the runner could not end (${procs.survivors.join(', ')}); the experiment stops and this run is not scored. End them before the next run`;
    if (escape) halt = true;
    const stampAfter = tryGuardStamp(plan.guard);
    const unreadable = stampAfter.error;
    const changed = unreadable ? null : stampDiff(stampBefore.stamp, stampAfter.stamp);
    if (unreadable) {
      escape = `left the lab folders in a state the workdir guard cannot read (${redactPaths(unreadable)}); the experiment stops and this run is not scored. Look for a link, a locked file or an unreadable folder in the repository or the data folder`;
      halt = true;
    } else if (changed?.startsWith(DATA_KEY) || changed?.startsWith(STORE_KEY)) {
      const prefix = changed.startsWith(DATA_KEY) ? DATA_KEY : STORE_KEY;
      const where = prefix === DATA_KEY ? 'in the data folder' : 'in the repository';
      const rest = changed.slice(prefix.length).replace(/\/\.?$/, '');
      const what = !rest || rest === '.' ? 'the folder itself' : rest;
      escape = `changed, added or removed ${what} ${where}, where the stored runs are, while it ran; the experiment stops and this run is not scored. Those runs are evidence: compare them with a backup before you trust them`;
      halt = true;
    } else if (changed?.startsWith('config: ')) {
      escape = `changed ${path.basename(changed)}, which names the data folder, while it ran; the experiment stops and this run is not scored. Check data_dir in that file before the next run`;
      halt = true;
    } else if (changed) {
      escape = `changed ${changed} in the lab repository while it ran; the experiment stops and this run is not scored. Check that file with git diff. If you edited it yourself during the call, this is a false alarm: keep your work and run again. Otherwise restore it (git checkout -- <file>) before the next run`;
      halt = true;
    } else if (!escape && mentionsFolder(`${JSON.stringify(result.events ?? [])}\n${result.text ?? ''}`, scopeFolders(plan.guard))) {
      escape = 'produced a reference to the lab repository outside its work folder in its response or tool trace. This conservative exclusion does not establish that hidden checks were read or repository files were changed';
    }
    if (escape) result = { ...result, error: { type: 'left_workdir', message: `The agent ${escape}.` } };
    if (halt) {
      // The halt goes to the ledger first, before any other write: whatever the agent did
      // to the run folder, a resume or a score of this run is then refused.
      // The ledger goes back to the bytes it held before the call, plus this halt: any
      // entry the agent wrote (a forged close for a planted run) is dropped, and kept aside.
      try {
        const aside = restoreLedger(plan.guard.ledger, ledgerBefore, { kind: 'halt', run_id: session.runId, reason: 'left_workdir' }, { realDir: plan.guard.ledgerDir, asideName: `lab.ledger.halted-${session.runId}-${crypto.randomBytes(3).toString('hex')}.jsonl` });
        if (aside) log(`  the ledger changed during the call; it is restored, and the changed copy is kept as ${path.basename(aside)}`);
      } catch (error) {
        log(`  warning: the ledger could not be restored after the halt (${error.message}). Do not trust any run until you check ${plan.guard.ledger}`);
      }
    }
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
  try {
    if (!result.error && plan.artifact) {
      const artifacts = writeArtifact(runDir, plan.artifact, row, redactPaths(result.text), adapter.name);
      if (artifacts) row.artifacts = artifacts;
    }
    if (testCase.input?.workspace != null) {
      // The agent's final workspace is evidence, kept even when the call failed or timed
      // out: the evaluator rebuilds it from this alone.
      const base = `artifacts/${safeSegment(row.case_id)}/${safeSegment(row.model_key)}__${safeSegment(adapter.name)}/r${repeat}/workspace`;
      // A call that crashed before its row was written may have left a snapshot; it is not
      // this call's. Never through a link: runPath refuses one on the way.
      fs.rmSync(runPath(runDir, base), { recursive: true, force: true });
      try {
        const artifact = snapshotWorkspace({ fixtureDir: workspaceDir(plan.suite, testCase), fixtureSha, workDir: callCwd, runDir, base, artifactId: `${row.case_id}__${row.model_key}__r${repeat}__workspace`, createdAt: isoNow() });
        row.artifacts = [...(row.artifacts || []), artifact];
      } catch (error) {
        log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: workspace not stored: ${error.message}`);
      }
    }
    if (isolatedDir) row.metadata.workdir_removed = removeFolder(callCwd);
    appendRunFile(runDir, 'raw.jsonl', rowLine(row));
    // Events keep what the call did, not how this machine is set up (lab/lib/redact.mjs).
    const events = (result.events || []).map((event) => rowLine({ case_id: row.case_id, model_key: row.model_key, repeat, event: redactEvent(event) })).join('');
    if (events) appendRunFile(runDir, 'harness-events.ndjson', events);
    // The row entry comes last: the row's line, and every file this call wrote.
    const now = callFiles(runDir);
    const written = Object.fromEntries(Object.entries(now).filter(([rel, sha]) => session.recorded[rel] !== sha));
    record(plan, { kind: 'row', run_id: session.runId, sha256: lineSha(rowLine(row)), files: written, events: eventsState(runDir) });
    session.recorded = now;
    session.done.add(rowKey(row.case_id, row.model_key, repeat));
    if (row.error) session.failures += 1;
    if (errorClass(row.error) === 'incomplete') session.incomplete += 1;
    heartbeat(session);
  } catch (error) {
    // A write that fails after the call stops the experiment, and the run still closes, so
    // it never stays "running". After a halted call the run stays halted. A failure the
    // guard did not explain (a busy file, a full disk) blames no agent: the run closes as
    // interrupted, and a resume drops the half-written row and calls it again.
    log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: could not store the row (${redactPaths(error.message)}); the experiment stops`);
    session.halted = halt ? 'left_workdir' : 'write_failed';
    return true;
  }
  if (modelChecked === 'mismatch') log(`  warning: ${adapter.name} reports model "${result.model_reported}", not "${m.harnessModel}"; the row is marked model_check mismatch`);
  if (isolatedDir && !row.metadata.workdir_removed) log(`  warning: could not delete the call folder ${callCwd}; a process the harness started may still hold it`);
  if (halt) {
    log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: ${row.error.message}`);
    session.halted = 'left_workdir';
    return true;
  }
  const shown = row.error ? `${errorClass(row.error) === 'incomplete' ? 'INCOMPLETE (unjudged)' : 'ERROR'} ${row.error.type}: ${row.error.message.split('\n')[0].slice(0, 120)}` : JSON.stringify(String(row.response.text).slice(0, 60));
  log(`  ${testCase.case_id} r${repeat} ${m.modelKey}: ${shown} · ${latency ?? '?'} ms · ${usage.input_tokens ?? '?'} in / ${usage.output_tokens ?? '?'} out`);
  return false;
}

/** Finish one run: status, harness version at the end, scores. */
async function closeRun(root, plan, session, { log, aborted, halted: haltedAs }) {
  let halted = haltedAs;
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
  try {
    writeRunFile(runDir, 'run.json', manifestText(manifest));
  } catch (error) {
    log(`  warning: could not write run.json of ${session.runId} (${redactPaths(error.message)})`);
  }
  if (session.halted === 'write_failed') {
    // A row may have reached raw.jsonl without its ledger entry. No close entry vouches for
    // it: the run stays open in the ledger, and a resume drops that row and calls it again.
    log(`  note: ${session.runId} stays open in the evidence ledger; continue it with node lab run --resume ${session.runId}`);
    halted = halted || 'write_failed';
  } else {
    try {
      record(plan, closeEntry('close', session.runId, runDir, { status: manifest.status, ...(halted ? { halted } : {}) }));
    } catch (error) {
      log(`  warning: the close entry could not be written to the ledger (${error.message}); this run reads as not trusted`);
      halted = halted || 'ledger_unwritable';
    }
  }
  // The changed files may include the hidden checks, so a halted run is not scored.
  const written = halted ? [] : scoreRun(root, runDir, { log });
  log(`\n${session.runId}`);
  for (const item of written) log(`  scored ${path.basename(item.file)}: ${item.count ? `${item.passed}/${item.count} passed` : 'no completed answers to judge'}`);
  const outcome = !stopped && session.incomplete > 0 && session.incomplete === session.attempts ? 'incomplete (unjudged)' : manifest.status;
  log(`  ${outcome}: ${session.attempts} attempt(s), ${session.failures - session.incomplete} error(s)${session.incomplete ? `, ${session.incomplete} unfinished and unjudged` : ''}`);
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
  // Fixed before the first run folder is made (see guardScope).
  plan.guard ??= guardScope(root);
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
    // A guard that could not read the folders before a call made no call and blames no
    // agent: every run closes as interrupted, and a resume continues it.
    const blamed = haltedBy && !['guard_unreadable', 'write_failed'].includes(haltedBy.halted);
    const halted = blamed ? (session === haltedBy ? 'left_workdir' : 'experiment_halted') : null;
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
  log(`Execution deadline: ${plan.timeoutMs === 0 ? 'none' : `${plan.timeoutMs / 1000} s`}; elapsed time is measured separately.`);
  if (options.dryRun) {
    for (const { harness, effort, models } of plan.groups.values()) {
      const adapter = getAdapter(harness, root);
      const flags = plan.userConfig === 'isolated' ? adapter.isolation?.args || [] : [];
      for (const key of models) {
        const m = modelPlan(plan, adapter, key, effort);
        log(`  ${harness}: ${key} → model "${m.harnessModel}", effort ${m.recordedEffort ?? 'default'}${m.recordedEffort === 'unavailable' ? ' (no adjustable control; no effort flag sent)' : ''}, user setup ${flags.length ? `skipped (${flags.join(' ')})` : 'loaded'}${plan.access === 'edit' ? `, access edit (${(adapter.edit?.args || []).join(' ') || 'no flags'})` : ''}${m.notApplied.length ? `, not forwarded: ${m.notApplied.join(', ')}` : ''}${plan.registry[key]?.pinned === false ? ', alias (not a pinned snapshot)' : ''}`);
      }
    }
    log('Dry run: nothing was called or written.');
    return [];
  }
  // One writer at a time on every store (lab/lib/lock.mjs); a second runner is refused here.
  const release = takeLocks(storeFolders(root), { command: `node lab run ${plan.experiment.id}`, root, log });
  try {
    ensureLedger(root, { log });
    plan.guard = guardScope(root);
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
    return await withSigint(log, async (signal) => [...results, ...(await execute(root, plan, sessions, { log, signal }))]);
  } finally {
    release();
  }
}

/**
 * Continue a run that stopped before its last row: it crashed (stale) or the user
 * stopped it. The rows it has stay as they are; only the missing ones run, with the
 * same suite, prompt, models and harness version, or the resume is refused.
 */
export async function resumeCommand(root, ref, { log = console.log, force = false, dryRun = false } = {}) {
  if (dryRun) return resumeRun(root, ref, { log, force, dryRun });
  // The lock comes before the run is read, so no other runner writes its rows meanwhile.
  const release = takeLocks(storeFolders(root), { command: `node lab run --resume ${ref}`, root, log });
  try {
    return await resumeRun(root, ref, { log, force, dryRun });
  } finally {
    release();
  }
}

async function resumeRun(root, ref, { log, force, dryRun }) {
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
  const recordedTimeout = manifest.harness?.settings?.timeout_s ?? manifest.experiment.timeout_s;
  if (recordedTimeout == null) throw new Error(`${manifest.run_id} did not record its execution deadline; start a new run instead of changing its conditions on resume.`);
  const plan = planFromExperiment(root, { ...manifest.experiment, timeout_s: recordedTimeout }, {
    harness: manifest.harness.name,
    models: manifest.models.map((item) => item.model_key),
    sha: /sha256 ([a-f0-9]{64})/.exec(manifest.notes || '')?.[1] ?? null,
  });
  plan.experiment = manifest.experiment;
  const differs = [];
  if (plan.suite.sha256 !== manifest.suite.sha256) differs.push(`suite ${plan.suite.id} changed (run ${manifest.suite.version}, now ${plan.suite.version})`);
  if (plan.prompt.sha256 !== manifest.prompt.sha256) differs.push(`prompt ${plan.prompt.id} changed`);
  if (plan.repeats !== manifest.repeats) differs.push(`repeats ${plan.repeats} differ from the run's ${manifest.repeats}`);
  const adapter = getAdapter(manifest.harness.name, root);
  // The run is one group of the experiment: the one whose effort gives the efforts it recorded.
  const sameEffort = (group) => manifest.models.every((item) => group.models.includes(item.model_key) && (modelPlan(plan, adapter, item.model_key, group.effort).recordedEffort ?? null) === (item.reasoning_effort ?? null));
  const group = [...plan.groups.values()].find((item) => item.harness === manifest.harness.name && sameEffort(item))
    ?? [...plan.groups.values()].find((item) => item.harness === manifest.harness.name);
  for (const item of manifest.models) {
    const now = modelPlan(plan, adapter, item.model_key, group?.effort);
    if (now.harnessModel !== item.model || (now.recordedEffort ?? null) !== (item.reasoning_effort ?? null)) differs.push(`${item.model_key} is now "${now.harnessModel}" at effort ${now.recordedEffort ?? 'default'}`);
  }
  // The rows of one run must share one access policy: a run made before a harness's tools
  // were turned off for answers (or with other edit flags) cannot continue under the new one.
  const accessNow = accessSettings(adapter, manifest.harness.settings?.access || 'answer').access_flags || [];
  const accessThen = manifest.harness.settings?.access_flags || [];
  if (JSON.stringify(accessNow) !== JSON.stringify(accessThen)) differs.push(`access flags are now [${accessNow.join(' ')}]; the run used [${accessThen.join(' ')}]`);
  if (differs.length) throw new Error(`Cannot resume ${manifest.run_id}; its inputs changed:\n  ${differs.join('\n  ')}\nStart a new run.`);
  // The same check openRun makes, so a dry run never promises a resume that is refused.
  const detected = await adapter.detect();
  if (!detected.version) throw new Error(`${manifest.harness.name}: CLI not found or "--version" failed.`);
  if (String(detected.version) !== manifest.harness.version) {
    throw new Error(`${manifest.harness.name} is now ${detected.version}; the run used ${manifest.harness.version}. A resumed run must use the same harness version.`);
  }
  // The ledger decides what a resume may keep: a run it halted or cannot match is refused,
  // and the one unrecorded last row a crash may leave is dropped and called again.
  if (!dryRun) ensureLedger(root, { log });
  const resumeLedger = loadLedger(ledgerPath(root));
  const trust = trustRun(resumeLedger, manifest.run_id, runDir);
  const ledgerRun = resumeLedger?.runs?.get(manifest.run_id) || null;
  if (trust.state === 'halted') throw new Error(`${manifest.run_id} was halted by the workdir guard (evidence ledger: ${trust.reason}); it cannot be resumed. Start a new run.`);
  if (trust.state === 'untrusted') throw new Error(`Cannot resume ${manifest.run_id}: it does not match the evidence ledger (${trust.reason}). Start a new run.`);
  const rawFile = path.join(runDir, 'raw.jsonl');
  const { rows: readRows, problems } = readJsonl(rawFile);
  // A complete last row with no ledger entry (a crash between the two writes) is dropped
  // and called again; a torn last line is cut below, as before.
  const droppedRow = Boolean(trust.unrecorded_last && !problems.length);
  const rows = droppedRow ? readRows.slice(0, -1) : readRows;
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
  const total = plan.cases.length * plan.repeats * manifest.models.length;
  if (dryRun) {
    log(`Resume ${manifest.run_id}: ${rows.length} row(s) kept, ${total - rows.length} call(s) to make${tornLine ? '; a torn last line would be dropped' : ''}${droppedRow ? '; an unrecorded last row would be dropped' : ''}.`);
    log('Dry run: nothing was called or written.');
    return [];
  }
  plan.guard = guardScope(root);
  // The resume entry comes before any write: it reopens the run with the rows it keeps
  // and its files now, so a crash during the resume leaves a run that is open, not changed.
  const kept = rowLines(runDir).lines.slice(0, rows.length);
  // The files of every call still to make (left by a call that crashed or stopped before
  // its row) belong to no kept row: they are not recorded, and are removed after the
  // resume entry, so a call made again never shows as a change to a recorded file.
  const done = new Set(rows.map((row) => rowKey(row.case_id, row.model_key, row.repeat)));
  const redo = [];
  for (const testCase of plan.cases) {
    for (const { model_key: modelKey } of manifest.models) {
      for (let repeat = 0; repeat < plan.repeats; repeat += 1) {
        if (done.has(rowKey(testCase.case_id, modelKey, repeat))) continue;
        for (const segment of [(value) => value, safeSegment]) redo.push(`artifacts/${segment(testCase.case_id)}/${segment(modelKey)}__${segment(manifest.harness.name)}/r${repeat}/`);
      }
    }
  }
  const recorded = Object.fromEntries(Object.entries(callFiles(runDir)).filter(([rel]) => !redo.some((prefix) => rel.startsWith(prefix))));
  // The events kept: those the ledger recorded with the last kept row (a closed run: all).
  // Events of a call made again are cut, so they are never vouched for twice.
  const eventsFile = path.join(runDir, 'harness-events.ndjson');
  // A run open since before row entries bound events (rows, but no events record): its
  // events are kept as they are, never cut.
  const unbound = !ledgerRun?.events && (ledgerRun?.lines?.length ?? 0) > 0;
  const eventsKeep = ledgerRun?.closed || unbound ? eventsState(runDir) : ledgerRun?.events || { size: 0, sha256: eventsState(runDir, 0).sha256 };
  record(plan, { kind: 'resume', run_id: manifest.run_id, lines: kept, files: recorded, events: eventsKeep, core: manifestCore(manifest) });
  for (const prefix of new Set(redo)) {
    // Never through a link: a link on the way would remove another run's files.
    const dir = runPath(runDir, `${prefix}x`);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true }); // not a run file: a call folder that runPath checked on the line above
  }
  if (fs.existsSync(eventsFile) && fs.statSync(eventsFile).size > eventsKeep.size) fs.truncateSync(own(eventsFile), eventsKeep.size);
  if (droppedRow || tornLine) {
    fs.truncateSync(own(rawFile), Buffer.byteLength(text.slice(0, (text.endsWith('\n') ? text.slice(0, -1) : text).lastIndexOf('\n') + 1), 'utf8'));
    if (droppedRow) log(`  note: dropped the last row of ${manifest.run_id}: the ledger has no entry for it (a crash between the two writes); it is called again`);
  }
  if (addNewline && !droppedRow) appendRunFile(runDir, 'raw.jsonl', '\n');
  const session = await openRun(root, plan, manifest.harness.name, manifest.models.map((item) => item.model_key), { log, effort: group?.effort, resume: { manifest, runDir, rows, tornLine, recorded } });
  return withSigint(log, (signal) => execute(root, plan, [session], { log, signal }));
}
