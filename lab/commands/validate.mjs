// Checks every input and every stored record against the contract: schemas,
// IDs, references between files, and the one-row-per-observation rule.

import fs from 'node:fs';
import path from 'node:path';
import { listDirs, listFiles, readJson, readJsonl } from '../lib/fsutil.mjs';
import { SchemaSet } from '../lib/schema.mjs';
import { ARCHIVE, VERSIONS_DIR, frozenVersions, targetProblems as checkTargets, loadPrompt, loadRegistry, loadSuite, loadYamlFile, paths, resolveExperiment, runDirs, suiteFolders } from '../lib/repo.mjs';
import { harnessesFile, loadAdapters, readDeclared } from '../adapters/index.mjs';
import { getEvaluator } from '../evaluators/index.mjs';
import { listTree } from '../lib/workspace.mjs';
import { runLiveness } from '../lib/checks.mjs';
import { LEDGER_SCHEMA, ledgerPath, loadLedger, scoreFileNames, trustRun } from '../lib/ledger.mjs';
import { FILL_IN, unfilled } from './new-case.mjs';

export function validateRepo(root) {
  const p = paths(root);
  const schemas = new SchemaSet(p.schemas);
  const problems = [];
  // Warnings do not fail validate: a stale run is evidence as it stands, and resuming it is the owner's choice.
  const warnings = [];
  const counts = { suites: 0, cases: 0, prompts: 0, experiments: 0, runs: 0, rows: 0, scores: 0, annotations: 0, boards: 0 };
  const rel = (file) => path.relative(root, file).replace(/\\/g, '/');
  const report = (file, message) => problems.push(`${rel(file)}: ${message}`);
  const check = (schema, value, file) => schemas.validate(schema, value).forEach((error) => report(file, error));

  let adapters = loadAdapters(null);
  try {
    readDeclared(root).problems.forEach((problem) => report(harnessesFile(root), problem));
    adapters = loadAdapters(root);
  } catch (error) {
    report(harnessesFile(root), error.message);
  }

  let registry = {};
  try {
    registry = loadRegistry(root);
    for (const [key, entry] of Object.entries(registry)) {
      if (!/^[a-z0-9][a-z0-9.-]*$/.test(key)) report(p.registry, `model_key "${key}" should be lowercase letters, digits, dots and dashes`);
      if (!entry.provider || !entry.model) report(p.registry, `${key}: needs provider and model`);
      if (entry.pricing != null && (typeof entry.pricing.input_per_1m !== 'number' || typeof entry.pricing.output_per_1m !== 'number')) {
        report(p.registry, `${key}: pricing needs both input_per_1m and output_per_1m, or leave pricing out`);
      }
      if (entry.pinned != null && typeof entry.pinned !== 'boolean') report(p.registry, `${key}: pinned must be true or false`);
      for (const harness of Object.keys(entry.harness_models || {})) {
        if (!adapters[harness]) report(p.registry, `${key}: harness_models names unknown harness "${harness}"`);
      }
    }
  } catch (error) {
    report(p.registry, error.message);
  }

  const suites = new Map();
  // datasets/<id>/ holds the active suites; datasets/archive/<id>/ the retired ones, which old runs still name.
  // An id lives in one place, and datasets/archive/ itself is a folder of suites, not a suite.
  if (fs.existsSync(path.join(p.datasetsArchive, 'suite.yaml'))) report(p.datasetsArchive, `datasets/${ARCHIVE}/ is the folder of retired suites, not a suite; remove its suite.yaml`);
  const folders = suiteFolders(root);
  for (const { id, archived } of folders) {
    if (archived && folders.some((other) => !other.archived && other.id === id)) report(path.join(p.datasetsArchive, id), `suite "${id}" is in datasets/${id} and in datasets/${ARCHIVE}/${id}; keep it in one place`);
  }
  for (const { id: name, dir: suiteFolder, archived } of folders) {
    if (archived && suites.has(name)) continue;
    try {
      const suite = loadSuite(root, name);
      suites.set(name, suite);
      counts.suites += 1;
      const seen = new Set();
      const file = path.join(suiteFolder, 'cases.jsonl');
      suite.cases.forEach((item, index) => {
        counts.cases += 1;
        schemas.validate('case.schema.json', item).forEach((error) => report(file, `line ${index + 1}: ${error}`));
        if (seen.has(item.case_id)) report(file, `duplicate case_id ${item.case_id}`);
        seen.add(item.case_id);
        if (!String(item.case_id).startsWith(`${name}-`)) report(file, `case_id ${item.case_id} should start with "${name}-"`);
        const workspace = item.input?.workspace;
        if (workspace != null) {
          if (typeof workspace !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(workspace)) report(file, `line ${index + 1}: input.workspace must be a plain folder name`);
          else if (!fs.existsSync(path.join(suite.dir, 'workspaces', workspace))) report(file, `line ${index + 1}: workspaces/${workspace} does not exist`);
          else {
            const others = [];
            listTree(path.join(suite.dir, 'workspaces', workspace), undefined, others);
            if (others.length) report(file, `line ${index + 1}: workspaces/${workspace} holds ${others.join(', ')}, which is not a regular file or folder`);
          }
        }
        const checkName = item.expected?.check;
        if (checkName != null) {
          const checkDir = path.join(suite.dir, 'checks', String(checkName));
          if (typeof checkName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(checkName)) report(file, `line ${index + 1}: expected.check must be a plain folder name`);
          else if (!fs.existsSync(path.join(checkDir, 'probe.mjs'))) report(file, `line ${index + 1}: checks/${checkName}/probe.mjs does not exist`);
          else {
            try {
              const expected = readJson(path.join(checkDir, 'expected.json'));
              const probes = expected?.probes ?? {};
              const files = expected?.files ?? {};
              if (typeof probes !== 'object' || Array.isArray(probes) || typeof files !== 'object' || Array.isArray(files)) report(file, `line ${index + 1}: checks/${checkName}/expected.json needs objects "probes" and "files"`);
              else if (!Object.keys(probes).length && !Object.keys(files).length) report(file, `line ${index + 1}: checks/${checkName}/expected.json has no tests`);
              for (const rel of Object.keys(files)) if (!/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*$/.test(rel) || rel.split('/').includes('..')) report(file, `line ${index + 1}: checks/${checkName}/expected.json file "${rel}" must be a plain relative path`);
            } catch (error) {
              report(file, `line ${index + 1}: checks/${checkName}/expected.json: ${error.message}`);
            }
          }
          if (workspace == null) report(file, `line ${index + 1}: expected.check needs input.workspace`);
        }
      });
      const scaffold = ['checks', 'workspaces'].flatMap((dir) => listTree(path.join(suite.dir, dir)).map((rel) => path.join(suite.dir, dir, ...rel.split('/'))));
      for (const hit of unfilled([file, ...scaffold])) report(hit.file, `line ${hit.line}: still holds ${FILL_IN}; write the real value`);
      // Frozen copies of earlier versions (datasets/<suite>/versions/<version>/, lab/lib/repo.mjs loadSuite).
      suite.frozenCopies = new Map();
      const versionsDir = path.join(suiteFolder, VERSIONS_DIR);
      const named = new Set(frozenVersions(suiteFolder));
      for (const entry of fs.existsSync(versionsDir) ? fs.readdirSync(versionsDir) : []) {
        if (!named.has(entry)) report(path.join(versionsDir, entry), `${VERSIONS_DIR}/ holds only folders named by a version, like 1.0.0`);
      }
      for (const old of named) {
        const copyDir = path.join(versionsDir, old);
        if (old === suite.version) {
          report(copyDir, `version ${old} is the current version of ${name}; a frozen copy is only for an earlier one`);
          continue;
        }
        try {
          const copy = loadSuite(root, name, { version: old });
          if (!copy) {
            report(copyDir, `a frozen copy needs suite.yaml and cases.jsonl`);
            continue;
          }
          if (copy.id !== suite.id) report(path.join(copyDir, 'suite.yaml'), `id "${copy.id}" is not "${suite.id}"`);
          if (copy.version !== old) report(path.join(copyDir, 'suite.yaml'), `version ${copy.version} does not match the folder name ${old}`);
          const ids = new Set();
          copy.cases.forEach((item, index) => {
            schemas.validate('case.schema.json', item).forEach((error) => report(path.join(copyDir, 'cases.jsonl'), `line ${index + 1}: ${error}`));
            if (ids.has(item.case_id)) report(path.join(copyDir, 'cases.jsonl'), `duplicate case_id ${item.case_id}`);
            ids.add(item.case_id);
          });
          suite.frozenCopies.set(old, copy);
        } catch (error) {
          report(copyDir, error.message);
        }
      }
    } catch (error) {
      report(suiteFolder, error.message);
    }
  }

  for (const name of listDirs(p.prompts)) {
    try {
      const prompt = loadPrompt(root, name);
      counts.prompts += 1;
      const used = new Set(prompt.messages.flatMap((message) => [...String(message.content).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1])));
      for (const variable of used) {
        if (!prompt.variables.includes(variable)) report(path.join(p.prompts, name, 'prompt.yaml'), `template uses {{${variable}}} but variables does not list it`);
      }
    } catch (error) {
      report(path.join(p.prompts, name), error.message);
    }
  }

  const experimentFiles = [...listFiles(p.experiments, '.yaml').map((file) => path.join(p.experiments, file)), ...listFiles(p.experimentsArchive, '.yaml').map((file) => path.join(p.experimentsArchive, file))];
  for (const abs of experimentFiles) {
    counts.experiments += 1;
    try {
      const experiment = loadYamlFile(abs);
      const { targets, problems: targetProblems } = resolveExperiment(experiment, registry);
      targetProblems.forEach((message) => report(abs, message));
      for (const message of checkTargets(targets.filter((target) => target.harness), registry, adapters)) report(abs, message);
      if (experiment.user_config != null && !['loaded', 'isolated'].includes(experiment.user_config)) report(abs, `user_config must be "loaded" or "isolated"`);
      if (experiment.access != null && !['answer', 'edit'].includes(experiment.access)) report(abs, `access must be "answer" or "edit"`);
      const suite = suites.get(experiment.suite);
      if (!suite) report(abs, `suite "${experiment.suite}" not found`);
      const usesWorkspace = suite && (experiment.cases || suite.cases.map((item) => item.case_id)).some((id) => suite.cases.find((entry) => entry.case_id === id)?.input?.workspace != null);
      if ((experiment.access === 'edit' || usesWorkspace) && experiment.workdir === 'repo') report(abs, `workdir must be "isolated" when access is "edit" or a case has a workspace`);
      if (usesWorkspace && experiment.access !== 'edit') report(abs, `access must be "edit": a case has a workspace, and without edit access the agent cannot change any file`);
      let prompt = null;
      try {
        prompt = loadPrompt(root, experiment.prompt, experiment.prompt_version);
      } catch (error) {
        report(abs, error.message);
      }
      for (const evaluator of experiment.evaluators || []) {
        if (!getEvaluator(evaluator.id, String(evaluator.version))) report(abs, `no evaluator ${evaluator.id}@${evaluator.version} in lab/evaluators`);
        if (typeof evaluator.version !== 'string') report(abs, `evaluator ${evaluator.id} version must be a quoted string`);
      }
      if (suite && prompt) {
        const ids = experiment.cases || suite.cases.map((item) => item.case_id);
        for (const id of ids) {
          const item = suite.cases.find((entry) => entry.case_id === id);
          if (!item) report(abs, `case ${id} is not in suite ${suite.id}`);
          else {
            const missing = prompt.variables.filter((name) => !(name in (item.input || {})));
            if (missing.length) report(abs, `case ${id} lacks prompt variable(s) ${missing.join(', ')}`);
          }
        }
      }
    } catch (error) {
      report(abs, error.message);
    }
  }

  // The evidence ledger: every entry to its schema, every run checked against it.
  const ledger = loadLedger(ledgerPath(root));
  if (ledger?.unreadable) report(ledgerPath(root), `cannot read the evidence ledger (${ledger.unreadable}); no run is trusted until it can be read`);
  for (const item of ledger?.problems || []) report(ledgerPath(root), `line ${item.line}: ${item.message}`);
  // A torn line (a crash during an append, or an edit) loses its entry, which can only make
  // a run less trusted; the runs it named are reported below if they no longer match.
  for (const item of ledger?.torn || []) warnings.push(`${path.relative(root, ledgerPath(root)).replace(/\\/g, '/') || ledgerPath(root)}: line ${item.line}: ${item.message}; the entry on it is lost`);
  for (const { line, entry } of ledger?.entries || []) {
    schemas.validate(LEDGER_SCHEMA, entry).forEach((error) => report(ledgerPath(root), `line ${line}: ${error}`));
  }

  for (const { name, dir: runDir } of runDirs(root)) {
    const manifestFile = path.join(runDir, 'run.json');
    if (!fs.existsSync(manifestFile)) continue;
    counts.runs += 1;
    let manifest;
    try {
      manifest = readJson(manifestFile);
    } catch (error) {
      report(manifestFile, `invalid JSON: ${error.message}`);
      continue;
    }
    check('run.schema.json', manifest, manifestFile);
    try {
      const trust = trustRun(ledger, manifest.run_id, runDir);
      if (trust.state === 'untrusted') report(manifestFile, `does not match the evidence ledger: ${trust.reason}`);
      else if (trust.scores === 'mismatch' && listFiles(path.join(runDir, 'scores'), '.jsonl').length) report(manifestFile, `its scores do not match the evidence ledger (${trust.scores_reason}); run node lab score ${manifest.run_id}`);
      for (const rel of trust.stray_scores || []) report(path.join(runDir, ...rel.split('/')), 'not written by an evaluator of this run, so it is never read; delete it');
    } catch (error) {
      report(manifestFile, `cannot be checked against the evidence ledger: ${error.message}`);
    }
    const liveness = runLiveness(manifest);
    if (liveness === 'stale') warnings.push(`${rel(manifestFile)}: stopped without finishing; continue it with node lab run --resume ${name}`);
    if (liveness === 'unknown') warnings.push(`${rel(manifestFile)}: says running but has no heartbeat; if no runner is working on it, continue it with node lab run --resume ${name} --force`);
    if (manifest.run_id !== name) report(manifestFile, `run_id ${manifest.run_id} does not match its folder ${name}`);
    const rawFile = path.join(runDir, 'raw.jsonl');
    const { rows, problems: rawProblems } = readJsonl(rawFile);
    rawProblems.forEach((item) => report(rawFile, `line ${item.line}: ${item.message}`));
    const seen = new Set();
    rows.forEach((row, index) => {
      counts.rows += 1;
      schemas.validate('result.schema.json', row).forEach((error) => report(rawFile, `line ${index + 1}: ${error}`));
      const key = `${row.case_id}|${row.model_key}|${row.repeat}`;
      if (seen.has(key)) report(rawFile, `line ${index + 1}: duplicate observation ${key}`);
      seen.add(key);
      if (row.run_id !== manifest.run_id) report(rawFile, `line ${index + 1}: run_id differs from run.json`);
      for (const artifact of row.artifacts || []) {
        if (artifact.path && !artifact.derived && !fs.existsSync(path.join(runDir, artifact.path))) report(rawFile, `line ${index + 1}: artifact ${artifact.path} is missing`);
      }
    });
    if (manifest.status === 'completed') {
      // The suite's cases count only at the version the run recorded: a suite that grew
      // later does not make an older run look short. Unknown count: no check.
      // The version may also be a frozen copy (datasets/<suite>/versions/<version>/).
      const suite = suites.get(manifest.suite?.id);
      const recorded = String(manifest.suite?.version);
      const atVersion = suite && (String(suite.version) === recorded ? suite : suite.frozenCopies?.get(recorded));
      const cases = manifest.experiment?.cases?.length || (atVersion ? atVersion.cases.length : 0);
      const expected = (manifest.models || []).length * cases * (manifest.repeats || 1);
      if (expected && rows.length !== expected) report(rawFile, `completed run has ${rows.length} rows; expected ${expected} (models x cases x repeats)`);
    }
    // Scoring needs the exact suite the run used (lab/commands/score.mjs). A changed suite
    // keeps its old version only in a frozen copy, so a change without one is caught here.
    {
      const suite = suites.get(manifest.suite?.id);
      const recorded = String(manifest.suite?.version);
      const atVersion = suite && (String(suite.version) === recorded ? suite : suite.frozenCopies?.get(recorded));
      const where = `${manifest.suite?.id} ${recorded}`;
      if (suite && !atVersion) warnings.push(`${rel(manifestFile)}: suite ${where} has no frozen copy in ${rel(path.join(suite.dir, VERSIONS_DIR, recorded))}/, so this run cannot be scored again; its stored scores still count`);
      else if (atVersion && manifest.suite?.sha256 && atVersion.sha256 !== manifest.suite.sha256) {
        report(manifestFile, atVersion === suite
          ? `suite ${where} changed after this run (hash ${atVersion.sha256.slice(0, 12)}, the run recorded ${manifest.suite.sha256.slice(0, 12)}); restore it, or bump its version and freeze ${recorded} with the bytes this run used`
          : `the frozen copy of suite ${where} is not the content this run used (hash ${atVersion.sha256.slice(0, 12)}, the run recorded ${manifest.suite.sha256.slice(0, 12)})`);
      }
    }
    for (const file of listFiles(path.join(runDir, 'scores'), '.jsonl').filter((name) => scoreFileNames(manifest).has(`scores/${name}`))) {
      const scoreFile = path.join(runDir, 'scores', file);
      const { rows: scores, problems: scoreProblems } = readJsonl(scoreFile);
      scoreProblems.forEach((item) => report(scoreFile, `line ${item.line}: ${item.message}`));
      scores.forEach((score, index) => {
        counts.scores += 1;
        schemas.validate('score.schema.json', score).forEach((error) => report(scoreFile, `line ${index + 1}: ${error}`));
        if (`${score.evaluator_id}@${score.evaluator_version}.jsonl` !== file) report(scoreFile, `line ${index + 1}: evaluator ${score.evaluator_id}@${score.evaluator_version} does not match the file name`);
        if (!seen.has(`${score.case_id}|${score.model_key}|${score.repeat}`)) report(scoreFile, `line ${index + 1}: scores an observation with no raw row`);
      });
    }
  }

  const annotationFile = path.join(p.annotations, 'human@1.jsonl');
  const { rows: annotations, problems: annotationProblems } = readJsonl(annotationFile);
  annotationProblems.forEach((item) => report(annotationFile, `line ${item.line}: ${item.message}`));
  annotations.forEach((item, index) => {
    counts.annotations += 1;
    schemas.validate('annotation.schema.json', item).forEach((error) => report(annotationFile, `line ${index + 1}: ${error}`));
  });

  for (const file of listFiles(p.boards, '.json')) {
    counts.boards += 1;
    const abs = path.join(p.boards, file);
    try {
      check('board.schema.json', readJson(abs), abs);
    } catch (error) {
      report(abs, `invalid JSON: ${error.message}`);
    }
  }

  return { problems, warnings, counts };
}

export function validateCommand(root, { log = console.log } = {}) {
  const { problems, warnings, counts } = validateRepo(root);
  log(Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(' · '));
  for (const line of warnings) log(`warning: ${line}`);
  if (problems.length) {
    log(`\n${problems.length} problem(s):`);
    problems.forEach((line) => log(`  ${line}`));
    return 1;
  }
  log('All inputs and records are valid.');
  return 0;
}
