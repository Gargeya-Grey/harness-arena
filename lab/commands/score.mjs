// Recomputes scores/<evaluator>@<version>.jsonl for a run from raw.jsonl and
// the suite's cases. No API calls: scores are derived and safe to regenerate.

import fs from 'node:fs';
import path from 'node:path';
import { listDirs, readJson, readJsonl } from '../lib/fsutil.mjs';
import { findRunDir, loadSuite, runDirs } from '../lib/repo.mjs';
import { storeFolder, takeLock } from '../lib/lock.mjs';
import { getEvaluator } from '../evaluators/index.mjs';

export function resolveRunDir(root, ref) {
  if (fs.existsSync(path.join(ref, 'run.json'))) return path.resolve(ref);
  const direct = findRunDir(root, ref);
  if (direct) return direct;
  const matches = runDirs(root).filter(({ name }) => name.includes(ref));
  if (matches.length === 1) return matches[0].dir;
  if (matches.length > 1) throw new Error(`"${ref}" matches ${matches.length} runs; give more of the run id`);
  throw new Error(`No run matches "${ref}"`);
}

export function scoreRun(root, runDir, { log = () => {}, force = false } = {}) {
  const manifest = readJson(path.join(runDir, 'run.json'));
  // A run stopped by the workdir guard may have been scored against changed files.
  if (manifest.harness?.settings?.halted && !force) {
    log(`  skip: this run was stopped (${manifest.harness.settings.halted}); pass --force to score it anyway`);
    return [];
  }
  const { rows, problems } = readJsonl(path.join(runDir, 'raw.jsonl'));
  if (problems.length) throw new Error(`raw.jsonl line ${problems[0].line}: ${problems[0].message}`);
  const suite = loadSuite(root, manifest.suite.id);
  if (suite.version !== manifest.suite.version || suite.sha256 !== manifest.suite.sha256) {
    log(`  note: suite ${suite.id} changed since this run (run ${manifest.suite.version}, now ${suite.version}); scoring against the current cases`);
  }
  const cases = new Map(suite.cases.map((item) => [item.case_id, item]));
  const written = [];
  for (const spec of manifest.evaluators || []) {
    const evaluator = getEvaluator(spec.id, spec.version);
    if (!evaluator) {
      log(`  skip: no evaluator ${spec.id}@${spec.version} in lab/evaluators`);
      continue;
    }
    const scores = [];
    for (const raw of rows) {
      if (raw.error) continue;
      const testCase = cases.get(raw.case_id);
      if (!testCase) continue;
      const result = evaluator.score({ raw, testCase, suite, runDir });
      if (!result) continue;
      if (result.skip) {
        log(`  ${raw.case_id} r${raw.repeat} ${raw.model_key}: not scored, ${result.skip}`);
        continue;
      }
      scores.push({
        run_id: manifest.run_id,
        case_id: raw.case_id,
        model_key: raw.model_key,
        repeat: raw.repeat,
        evaluator_id: evaluator.id,
        evaluator_version: evaluator.version,
        dimension: spec.dimension || evaluator.dimension,
        value: result.value,
        passed: result.passed,
        details: result.details,
      });
    }
    const file = path.join(runDir, 'scores', `${evaluator.id}@${evaluator.version}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, scores.map((score) => JSON.stringify(score)).join('\n') + (scores.length ? '\n' : ''), 'utf8');
    written.push({ file, count: scores.length, passed: scores.filter((score) => score.passed).length });
  }
  return written;
}

export function scoreCommand(root, refs, { all = false, force = false, log = console.log } = {}) {
  const dirs = all ? runDirs(root).map(({ dir }) => dir).filter((dir) => fs.existsSync(path.join(dir, 'run.json'))) : refs.map((ref) => resolveRunDir(root, ref));
  if (!dirs.length) throw new Error('Name a run id (or part of one), or pass --all');
  // Scores live in the data folder too, so scoring waits for no runner: one writer at a time.
  const release = takeLock(storeFolder(root), { command: 'node lab score', root, log });
  try {
    for (const dir of dirs) {
      log(path.basename(dir));
      for (const item of scoreRun(root, dir, { log, force })) {
        log(`  ${path.relative(dir, item.file).replace(/\\/g, '/')}: ${item.count} scores, ${item.passed} passed`);
      }
    }
  } finally {
    release();
  }
}
