// Loads the versioned inputs (registry, suites, prompts, experiments) from a
// repository root. LAB_ROOT overrides the root, so tests and UI work run
// against tests/fixtures/repo without touching real evidence.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml.mjs';
import { readJsonl, readText, sha256 } from './fsutil.mjs';
import { treeHash } from './workspace.mjs';

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
    if (target.effort !== undefined && target.effort !== 'default' && !adapter.supports_effort) {
      problems.push(`${target.harness} has no effort control, so effort "${target.effort}" for ${target.model} cannot apply; remove it or use another harness`);
      continue;
    }
    const effort = effectiveEffort(target, registry[target.model], adapter) ?? 'default';
    const key = `${target.model}|${target.harness}|${effort}`;
    if (seen.has(key)) problems.push(`${target.model} on ${target.harness} is listed twice at effort ${effort}: one configuration`);
    seen.add(key);
  }
  return problems;
}

/**
 * The effort a target really runs at: its own, else the registry's, through a harness
 * that can set effort; null (the harness default) otherwise. Two targets with the same
 * model, harness and effective effort are one configuration.
 */
export function effectiveEffort(target, entry, adapter) {
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

export function loadSuite(root, suiteId) {
  const dir = suiteDir(root, suiteId) ?? path.join(paths(root).datasets, String(suiteId));
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
  const extra = ['workspaces', 'checks'].filter((name) => fs.existsSync(path.join(dir, name))).map((name) => Buffer.from(`${name}:${treeHash(path.join(dir, name))}`));
  return {
    id: meta.id ?? suiteId,
    version: String(meta.version),
    meta,
    cases,
    dir,
    // The stored hash covers suite.yaml followed by cases.jsonl, byte for byte,
    // then the hash of each workspaces/ and checks/ folder when present.
    sha256: sha256(Buffer.concat([suiteBytes, caseBytes, ...extra])),
  };
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

export function loadCases(root, suiteId) {
  try {
    return loadSuite(root, suiteId).cases;
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

/**
 * The targets of an experiment, one per model x harness x effort. `effort` is undefined
 * when the target sets none (the registry's reasoning_effort applies), a word such as
 * "high", or "default" for the harness default.
 */
export function resolveExperiment(experiment, registry) {
  const problems = [];
  const targets = [];
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
