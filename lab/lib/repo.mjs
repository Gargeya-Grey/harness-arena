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

export function paths(root = labRoot()) {
  return {
    root,
    registry: path.join(root, 'configs', 'models.yaml'),
    datasets: path.join(root, 'datasets'),
    prompts: path.join(root, 'prompts'),
    experiments: path.join(root, 'experiments'),
    results: path.join(root, 'results'),
    annotations: path.join(root, 'annotations'),
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

export function loadSuite(root, suiteId) {
  const dir = path.join(paths(root).datasets, suiteId);
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
  const seen = new Set();
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
      const key = `${entry.model}|${entry.harness}|${effort ?? registry[entry.model]?.reasoning_effort ?? 'default'}`;
      if (seen.has(key)) problems.push(`targets[${index}]: ${entry.model} on ${entry.harness} at effort ${effort ?? 'registry'} is listed twice`);
      seen.add(key);
      targets.push({ model: entry.model, harness: entry.harness, label: entry.label || null, effort });
    }
  }
  if (!targets.length) problems.push('Experiment declares no targets or models');
  if (!experiment.id) problems.push('Experiment has no "id"');
  if (!experiment.suite) problems.push('Experiment has no "suite"');
  if (!experiment.prompt) problems.push('Experiment has no "prompt"');
  return { targets, problems };
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
