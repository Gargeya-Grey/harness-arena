// Recomputes scores/<evaluator>@<version>.jsonl for a run from raw.jsonl and
// the suite's cases. No API calls: scores are derived and safe to regenerate.

import fs from 'node:fs';
import path from 'node:path';
import { listDirs, readJson, readJsonl } from '../lib/fsutil.mjs';
import { VERSIONS_DIR, findRunDir, loadSuite, runDirs, suiteDir } from '../lib/repo.mjs';
import { storeFolders, takeLocks } from '../lib/lock.mjs';
import { appendEntry, ensureLedger, ledgerPath, loadLedger, scoresEntry, trustRun } from '../lib/ledger.mjs';
import { getEvaluator } from '../evaluators/index.mjs';
import { writeRunFile } from '../lib/runwrite.mjs';
import { errorClass } from '../lib/checks.mjs';

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
  // The evidence ledger comes first: a run that does not match it is never scored, and a
  // run it halted counts as halted whatever run.json says.
  const ledger = loadLedger(ledgerPath(root));
  const trust = trustRun(ledger, manifest.run_id, runDir);
  // Scores are derived: a mismatch of scores/ alone is repaired by scoring again.
  if (trust.state === 'untrusted') {
    log(`  skip: this run does not match the evidence ledger (${trust.reason}); it is not scored`);
    return [];
  }
  const halted = manifest.harness?.settings?.halted || (trust.state === 'halted' ? trust.reason : null);
  // A run stopped by the workdir guard may have been scored against changed files.
  if (halted && !force) {
    log(`  skip: this run was stopped (${halted}); pass --force to score it anyway`);
    return [];
  }
  const { rows, problems } = readJsonl(path.join(runDir, 'raw.jsonl'));
  if (problems.length) throw new Error(`raw.jsonl line ${problems[0].line}: ${problems[0].message}`);
  // Score against the exact suite the run used: the current folder at the run's version, or the
  // frozen copy of that version (datasets/<suite>/versions/<version>/). Anything else would judge
  // old answers by new cases or checks, so the run is not scored and its score files stay as they are.
  const suite = loadSuite(root, manifest.suite.id, { version: manifest.suite.version });
  if (!suite) {
    const copy = path.relative(root, path.join(suiteDir(root, manifest.suite.id), VERSIONS_DIR, String(manifest.suite.version))).replace(/\\/g, '/');
    log(`  skip: suite ${manifest.suite.id} is no longer at version ${manifest.suite.version}, and ${copy}/ holds no frozen copy of it; the run is not scored`);
    return [];
  }
  if (suite.sha256 !== manifest.suite.sha256) {
    log(`  skip: suite ${manifest.suite.id} ${manifest.suite.version}${suite.frozen ? ' (frozen copy)' : ''} is not the content this run used (hash ${suite.sha256.slice(0, 12)}, the run recorded ${String(manifest.suite.sha256).slice(0, 12)}); the run is not scored`);
    return [];
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
    // A new file renamed into place, never written through a link (lab/lib/runwrite.mjs).
    const rel = `scores/${evaluator.id}@${evaluator.version}.jsonl`;
    const file = writeRunFile(runDir, rel, scores.map((score) => JSON.stringify(score)).join('\n') + (scores.length ? '\n' : ''));
    written.push({ file, rel, count: scores.length, passed: scores.filter((score) => score.passed).length });
  }
  // The ledger vouches only for the files written now. A file of an evaluator that could
  // not run stays unrecorded, so the run counts nowhere until it is rescored or adopted.
  if (ledger) appendEntry(ledgerPath(root), scoresEntry(manifest.run_id, runDir, manifest, written.map((item) => item.rel)));
  return written;
}

export function scoreCommand(root, refs, { all = false, force = false, log = console.log } = {}) {
  const dirs = all ? runDirs(root).map(({ dir }) => dir).filter((dir) => fs.existsSync(path.join(dir, 'run.json'))) : refs.map((ref) => resolveRunDir(root, ref));
  if (!dirs.length) throw new Error('Name a run id (or part of one), or pass --all');
  // Scores live in the data folder too, so scoring waits for no runner: one writer at a time.
  const release = takeLocks(storeFolders(root), { command: 'node lab score', root, log });
  try {
    ensureLedger(root, { log });
    for (const dir of dirs) {
      log(path.basename(dir));
      for (const item of scoreRun(root, dir, { log, force })) {
        log(item.count ? `  ${path.relative(dir, item.file).replace(/\\/g, '/')}: ${item.count} scores, ${item.passed} passed` : `  ${path.relative(dir, item.file).replace(/\\/g, '/')}: no completed answers to judge`);
      }
      const incomplete = readJsonl(path.join(dir, 'raw.jsonl')).rows.filter((row) => errorClass(row.error) === 'incomplete').length;
      if (incomplete) log(`  ${incomplete} unfinished attempt${incomplete === 1 ? '' : 's'}, unjudged`);
    }
  } finally {
    release();
  }
}
