// Loads the versioned inputs (registry, suites, prompts, experiments) from a
// repository root. LAB_ROOT overrides the root, so tests and UI work run
// against tests/fixtures/repo without touching real evidence.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml.mjs';
import { readJsonl, readText, sha256 } from './fsutil.mjs';
import { copyTree, treeHash } from './workspace.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function labRoot() {
  return process.env.LAB_ROOT ? path.resolve(process.env.LAB_ROOT) : REPO_ROOT;
}

const LOCAL_CONFIG = 'lab.local.yaml';

/** The folder name of retired suites (datasets/archive/<id>/) and experiments (experiments/archive/). It is never a suite id. */
export const ARCHIVE = 'archive';

/** The main checkout of a git worktree (its `.git` is a file that names the main repository), or null. */
export function mainCheckout(root) {
  const gitFile = path.join(root, '.git');
  try {
    if (!fs.statSync(gitFile).isFile()) return null;
    const gitdir = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitFile, 'utf8'))?.[1]?.trim();
    // <main>/.git/worktrees/<name>
    return gitdir ? path.resolve(root, gitdir, '..', '..', '..') : null;
  } catch {
    return null;
  }
}

/**
 * The data folder: where runs and human annotations are written, outside git, so that
 * git clean, a removed worktree or a fresh clone never deletes evidence. Set by LAB_DATA,
 * else by `data_dir` in lab.local.yaml (not committed) at the root or, in a worktree, at
 * the main checkout, so every worktree writes to the same store. Null: the root itself.
 * Tests (node --test) never pick up a local file; they set LAB_DATA when they need one.
 */
/** The main checkout and every worktree of the repository that root belongs to. */
export function checkouts(root) {
  const main = mainCheckout(root) ?? root;
  const out = new Set([path.resolve(root), path.resolve(main)]);
  const dir = path.join(main, '.git', 'worktrees');
  try {
    for (const name of fs.readdirSync(dir)) {
      // <main>/.git/worktrees/<name>/gitdir names <worktree>/.git
      const gitdir = fs.readFileSync(path.join(dir, name, 'gitdir'), 'utf8').trim();
      out.add(path.dirname(path.resolve(dir, name, gitdir)));
    }
  } catch {
    // No worktrees.
  }
  return [...out];
}

export function dataDir(root = labRoot(), env = process.env) {
  // Inside a checkout of this repository (the main one or any worktree), git clean or
  // git worktree remove would delete it, and that checkout's guard would see every
  // other run write there; so the data folder must be outside all of them.
  const outside = (dir, source) => {
    const inside = checkouts(root).find((checkout) => isInside(dir, checkout));
    if (inside) throw new Error(`${source}: the data folder ${dir} is inside the repository checkout ${inside}; put it outside, for example ../Model-Lab-Data`);
    return dir;
  };
  // Under the test runner a LAB_DATA from the shell is ignored, so tests never write fake
  // runs into a real store: a test that wants a data folder sets LAB_TEST_DATA to it too.
  const testing = Boolean(env.NODE_TEST_CONTEXT);
  if (env.LAB_DATA && (!testing || env.LAB_TEST_DATA === env.LAB_DATA)) return outside(path.resolve(env.LAB_DATA), 'LAB_DATA');
  if (testing || env.LAB_ROOT) return null;
  const main = mainCheckout(root);
  for (const dir of [root, main].filter(Boolean)) {
    const file = path.join(dir, LOCAL_CONFIG);
    if (!fs.existsSync(file)) continue;
    const value = parseYaml(readText(file))?.data_dir;
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${file}: data_dir must be a folder path`);
    return outside(path.resolve(dir, value), file);
  }
  return null;
}

/** True when dir is parent or inside it. */
export function isInside(dir, parent) {
  const rel = path.relative(parent, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Problems of resolved targets that need the harnesses: an unknown harness, an effort on
 * a harness without effort control, and two targets that are one configuration (same
 * model, harness and effective effort). The planner, validate and the dashboard catalog
 * all use this one check.
 */
export function targetProblems(targets, registry, adapters) {
  const problems = [];
  const seen = new Set();
  for (const target of targets) {
    const adapter = adapters[target.harness];
    if (!adapter) {
      problems.push(`unknown harness "${target.harness}"; known: ${Object.keys(adapters).join(', ')}`);
      continue;
    }
    const effort = effectiveEffort(target, registry[target.model], adapter) ?? 'default';
    const levels = registry[target.model]?.effort_levels;
    if (effort === 'unavailable' && adapter.supports_effort && !(Array.isArray(levels) && levels.length === 0)) {
      problems.push(`${target.model} needs verified unavailable effort control (effort_levels: []) before effort "unavailable" can be used`);
      continue;
    }
    if (target.effort !== undefined && target.effort !== 'default' && target.effort !== 'unavailable' && !adapter.supports_effort) {
      problems.push(`${target.harness} has no effort control, so effort "${target.effort}" for ${target.model} cannot apply; remove it or use another harness`);
      continue;
    }
    if (Array.isArray(levels) && effort !== 'default' && effort !== 'unavailable' && !levels.includes(effort)) {
      problems.push(`${target.model} has supported effort levels [${levels.join(', ')}], so effort "${effort}" cannot apply`);
      continue;
    }
    const key = `${target.model}|${target.harness}|${effort}`;
    if (seen.has(key)) problems.push(`${target.model} on ${target.harness} is listed twice at effort ${effort}: one configuration`);
    seen.add(key);
  }
  return problems;
}

/**
 * The effort a target really runs at: its own, else the registry's, through a harness
 * that can set effort; null (the harness default) otherwise. "unavailable" records
 * explicitly unavailable control without sending an effort flag. Two targets with
 * the same model, harness and effective effort are one configuration.
 */
export function effectiveEffort(target, entry, adapter) {
  if (target.effort === 'unavailable') return 'unavailable';
  if (!adapter?.supports_effort) return null;
  if (target.effort === undefined) return entry?.reasoning_effort ?? null;
  return target.effort === 'default' ? null : target.effort;
}

export function paths(root = labRoot()) {
  const data = dataDir(root);
  const results = path.join(data ?? root, 'results');
  return {
    root,
    // Where new runs and annotations go. `resultsDirs` are every folder runs are read
    // from: the data folder first, then runs committed in the repository's results/.
    data,
    results,
    resultsDirs: [...new Set([results, path.join(root, 'results')])],
    registry: path.join(root, 'configs', 'models.yaml'),
    datasets: path.join(root, 'datasets'),
    // Retired suites: still loaded by id, so old runs stay readable and scorable.
    datasetsArchive: path.join(root, 'datasets', ARCHIVE),
    prompts: path.join(root, 'prompts'),
    experiments: path.join(root, 'experiments'),
    experimentsArchive: path.join(root, 'experiments', ARCHIVE),
    annotations: path.join(data ?? root, 'annotations'),
    boards: path.join(root, 'boards'),
    reports: path.join(root, 'reports'),
    cache: path.join(root, '.cache'),
    // Schemas are the contract of the code, not of the data root.
    schemas: path.join(REPO_ROOT, 'schemas'),
  };
}

export function loadYamlFile(file) {
  return parseYaml(readText(file), path.basename(file));
}

export function loadRegistry(root) {
  const file = paths(root).registry;
  if (!fs.existsSync(file)) return {};
  return loadYamlFile(file)?.models || {};
}

/**
 * The folder of a suite: datasets/<id>/, else datasets/archive/<id>/ for a retired suite.
 * An id must live in one place (validate reports a suite in both). Null: no such suite.
 */
export function suiteDir(root, suiteId) {
  const p = paths(root);
  if (typeof suiteId !== 'string' || !suiteId || suiteId === ARCHIVE) return null;
  for (const base of [p.datasets, p.datasetsArchive]) {
    const dir = path.join(base, suiteId);
    if (fs.existsSync(path.join(dir, 'suite.yaml'))) return dir;
  }
  return null;
}

/** Every suite folder, active first: { id, dir, archived }. A suite id found in both places is listed twice. */
export function suiteFolders(root) {
  const p = paths(root);
  const folders = [];
  for (const [base, archived] of [[p.datasets, false], [p.datasetsArchive, true]]) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && !(entry.name === ARCHIVE && !archived)) folders.push({ id: entry.name, dir: path.join(base, entry.name), archived });
    }
  }
  return folders;
}

// A frozen copy of an earlier suite version: datasets/<suite>/versions/<version>/ holds that
// version's suite.yaml and cases.jsonl, byte for byte, and its workspaces/ and checks/ when the
// suite has them. A copy is complete: it never borrows a folder from a later version. Runs keep
// the version they recorded; scoring and the derived views read the copy, so a new version
// never changes how an old run is judged. freezeSuite makes one.
export const VERSIONS_DIR = 'versions';
const VERSION_NAME = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

/** The versions that have a frozen copy in a suite folder, as strings. */
export function frozenVersions(dir) {
  const base = path.join(dir, VERSIONS_DIR);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && VERSION_NAME.test(entry.name)).map((entry) => entry.name).sort();
}

function readSuiteAt(dir, suiteId) {
  const suiteFile = path.join(dir, 'suite.yaml');
  const casesFile = path.join(dir, 'cases.jsonl');
  if (!fs.existsSync(suiteFile)) throw new Error(`Suite "${suiteId}" not found: ${suiteFile}`);
  const suiteBytes = fs.readFileSync(suiteFile);
  const caseBytes = fs.existsSync(casesFile) ? fs.readFileSync(casesFile) : Buffer.alloc(0);
  const meta = parseYaml(suiteBytes.toString('utf8'), 'suite.yaml');
  const { rows: cases, problems } = readJsonl(casesFile);
  if (problems.length) throw new Error(`${casesFile}:${problems[0].line}: ${problems[0].message}`);
  // Agent suites also carry starter workspaces and hidden checks; their bytes are
  // part of the suite's identity. Suites without them keep the old hash.
  const workspacesDir = path.join(dir, 'workspaces');
  const checksDir = path.join(dir, 'checks');
  const extra = [['workspaces', workspacesDir], ['checks', checksDir]].filter(([, folder]) => fs.existsSync(folder)).map(([name, folder]) => Buffer.from(`${name}:${treeHash(folder)}`));
  return {
    id: meta.id ?? suiteId,
    version: String(meta.version),
    meta,
    cases,
    dir,
    workspacesDir,
    checksDir,
    // The stored hash covers suite.yaml followed by cases.jsonl, byte for byte,
    // then the hash of each workspaces/ and checks/ folder when present.
    sha256: sha256(Buffer.concat([suiteBytes, caseBytes, ...extra])),
  };
}

/**
 * A suite as it is now, or, with { version }, as it was at that version: the current folder when
 * the version is the current one, else its frozen copy (VERSIONS_DIR). Null when that version has
 * no copy. `frozen` is true for a copy.
 */
export function loadSuite(root, suiteId, { version } = {}) {
  const dir = suiteDir(root, suiteId) ?? path.join(paths(root).datasets, String(suiteId));
  const current = readSuiteAt(dir, suiteId);
  if (version === undefined || version === null || String(version) === current.version) return { ...current, frozen: false };
  if (!VERSION_NAME.test(String(version))) return null;
  const copy = path.join(dir, VERSIONS_DIR, String(version));
  if (!FROZEN_FILES.every((name) => fs.existsSync(path.join(copy, name)))) return null;
  return { ...readSuiteAt(copy, suiteId), frozen: true };
}

/** The files every frozen copy has. */
export const FROZEN_FILES = ['suite.yaml', 'cases.jsonl'];

/**
 * Freeze the current version of a suite before it changes: copy suite.yaml, cases.jsonl and,
 * when present, workspaces/ and checks/ to versions/<version>/. Safe to repeat: an existing copy
 * with the same hash is kept; one that differs is an error. Returns { dir, version, created }.
 */
export function freezeSuite(root, suiteId) {
  const suite = loadSuite(root, suiteId);
  if (!VERSION_NAME.test(suite.version)) throw new Error(`suite ${suiteId} version "${suite.version}" cannot name a folder; use a version like 1.0.0`);
  const dest = path.join(suite.dir, VERSIONS_DIR, suite.version);
  if (fs.existsSync(dest)) {
    const existing = FROZEN_FILES.every((name) => fs.existsSync(path.join(dest, name))) ? readSuiteAt(dest, suiteId) : null;
    if (existing?.sha256 === suite.sha256) return { dir: dest, version: suite.version, created: false };
    throw new Error(`${dest} exists and is not the current content of ${suiteId} ${suite.version}; the suite changed without a new version, or the copy is broken`);
  }
  // Copy to a folder of its own beside versions/ (a name in versions/ would be read as a version),
  // check the hash, then rename into place. copyTree skips what the hash skips (.git, node_modules).
  const temp = fs.mkdtempSync(path.join(suite.dir, '.freeze-')); // not a run folder: a suite folder
  try {
    for (const name of FROZEN_FILES) fs.copyFileSync(path.join(suite.dir, name), path.join(temp, name)); // not a run folder: a suite's versions/
    for (const name of ['workspaces', 'checks']) {
      if (fs.existsSync(path.join(suite.dir, name))) copyTree(path.join(suite.dir, name), path.join(temp, name));
    }
    const copy = readSuiteAt(temp, suiteId);
    if (copy.sha256 !== suite.sha256) throw new Error(`the copy of ${suiteId} ${suite.version} does not hash like the suite; nothing was frozen`);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); // not a run folder: a suite's versions/
    fs.renameSync(temp, dest); // not a run folder: a suite's versions/
  } finally {
    fs.rmSync(temp, { recursive: true, force: true }); // not a run folder: a suite's versions/
  }
  return { dir: dest, version: suite.version, created: true };
}

export function loadPrompt(root, promptId, version) {
  const dir = path.join(paths(root).prompts, promptId);
  const metaFile = path.join(dir, 'prompt.yaml');
  if (!fs.existsSync(metaFile)) throw new Error(`Prompt "${promptId}" not found: ${metaFile}`);
  const meta = loadYamlFile(metaFile);
  const chosen = String(version ?? meta.current);
  const file = path.join(dir, `v${chosen}.yaml`);
  if (!fs.existsSync(file)) throw new Error(`Prompt "${promptId}" has no version ${chosen}: ${file}`);
  const bytes = fs.readFileSync(file);
  const template = parseYaml(bytes.toString('utf8'), `v${chosen}.yaml`);
  return {
    id: meta.id ?? promptId,
    version: chosen,
    variables: meta.variables || [],
    messages: template.messages || [],
    sha256: sha256(bytes),
  };
}

/** The cases of a suite, now or (with a version) at that version; [] when unknown. */
export function loadCases(root, suiteId, version) {
  try {
    return loadSuite(root, suiteId, { version })?.cases ?? [];
  } catch {
    return [];
  }
}

/**
 * Normalize an experiment into an explicit target list. A target is one model
 * key run through one harness. `models` plus a top-level `harness` is
 * shorthand for one target per model.
 */
const EFFORT = /^[a-z][a-z0-9-]{0,31}$/;

export function requiresExplicitEffort(root) {
  const file = path.join(root, 'configs', 'effort-policy.yaml');
  if (!fs.existsSync(file)) return false;
  if (parseYaml(readText(file), 'effort-policy.yaml')?.require !== 'explicit') throw new Error('configs/effort-policy.yaml must require explicit effort');
  return true;
}

/**
 * The targets of an experiment, one per model x harness x effort. `effort` is undefined
 * when the target sets none (the registry's reasoning_effort applies), a word such as
 * "high", or "default" for the harness default.
 */
export function resolveExperiment(experiment, registry, { requireExplicitEffort = false } = {}) {
  const problems = [];
  const targets = [];
  if (experiment.effort_policy != null && experiment.effort_policy !== 'explicit') problems.push('effort_policy must be "explicit" when supplied');
  if (experiment.timeout_s != null && (typeof experiment.timeout_s !== 'number' || !Number.isFinite(experiment.timeout_s) || experiment.timeout_s < 0 || experiment.timeout_s * 1000 > 2147483647)) {
    problems.push('timeout_s must be a finite number from 0 to 2147483.647 seconds; 0 means no execution deadline');
  }
  const declared = Array.isArray(experiment.targets)
    ? experiment.targets
    : (experiment.models || []).map((model) => ({ model, harness: experiment.harness }));
  for (const [index, target] of declared.entries()) {
    const entry = typeof target === 'string' ? { model: target, harness: experiment.harness } : { harness: experiment.harness, ...target };
    if (!entry?.model) {
      problems.push(`targets[${index}]: missing "model"`);
      continue;
    }
    if (!registry[entry.model]) problems.push(`targets[${index}]: model "${entry.model}" is not in configs/models.yaml`);
    if (!entry.harness) problems.push(`targets[${index}]: no harness for "${entry.model}"; add "harness:" to the target or the experiment`);
    // Effort: the target's `effort` or `efforts` list, else the experiment's `effort`, else
    // the registry entry's reasoning_effort. "default" means the harness default.
    if (entry.effort != null && entry.efforts != null) problems.push(`targets[${index}]: give "effort" or "efforts", not both`);
    const efforts = entry.efforts != null ? entry.efforts : [entry.effort ?? experiment.effort ?? undefined];
    if (!Array.isArray(efforts) || !efforts.length) {
      problems.push(`targets[${index}]: "efforts" must be a non-empty list`);
      continue;
    }
    for (const effort of efforts) {
      if ((requireExplicitEffort || experiment.effort_policy === 'explicit') && (effort === undefined || effort === 'default')) {
        problems.push(`targets[${index}]: explicit effort policy requires a named effort for ${entry.model}; set effort or efforts on the target or experiment`);
      }
      if ((requireExplicitEffort || experiment.effort_policy === 'explicit') && effort !== undefined && effort !== 'default' && effort !== 'unavailable') {
        const levels = registry[entry.model]?.effort_levels;
        if (!Array.isArray(levels) || !levels.every((level) => typeof level === 'string' && EFFORT.test(level) && level !== 'default' && level !== 'unavailable')) {
          problems.push(`targets[${index}]: ${entry.model} needs a verified effort_levels array before a controlled effort can be selected`);
        }
      }
      if (effort !== undefined && !(typeof effort === 'string' && EFFORT.test(effort))) {
        problems.push(`targets[${index}]: effort ${JSON.stringify(effort)} must be a word such as low, medium, high or default`);
        continue;
      }
      targets.push({ model: entry.model, harness: entry.harness, label: entry.label || null, effort });
    }
  }
  if (!targets.length) problems.push('Experiment declares no targets or models');
  if (!experiment.id) problems.push('Experiment has no "id"');
  if (!experiment.suite) problems.push('Experiment has no "suite"');
  if (!experiment.prompt) problems.push('Experiment has no "prompt"');
  return { targets, problems };
}

/** Every run folder, each id once (the data folder wins over a committed copy). */
export function runDirs(root = labRoot()) {
  const seen = new Map();
  for (const base of paths(root).resultsDirs) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && !seen.has(entry.name)) seen.set(entry.name, path.join(base, entry.name));
    }
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => ({ name, dir }));
}

/** The folder of one run id, or null. */
export function findRunDir(root, id) {
  for (const base of paths(root).resultsDirs) {
    const dir = path.join(base, id);
    if (fs.existsSync(path.join(dir, 'run.json'))) return dir;
  }
  return null;
}

/** Fill `{{name}}` placeholders. A missing variable is an error, never blank. */
export function renderMessages(messages, input) {
  return messages.map((message) => ({
    role: message.role,
    content: String(message.content).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name) => {
      if (!(name in input)) throw new Error(`Case input has no variable "${name}"`);
      return String(input[name]);
    }),
  }));
}
