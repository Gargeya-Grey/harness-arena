// Retired suites live in datasets/archive/<id>/ and retired experiments in experiments/archive/.
// Runs name a suite by id, so an old committed run must still load, validate, score and show.
// These tests copy one committed run into a disposable root: results/ is never written.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreRun } from '../lab/commands/score.mjs';
import { newCase } from '../lab/commands/new-case.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { readJson, readJsonl } from '../lab/lib/fsutil.mjs';
import { loadCases, loadSuite, suiteDir, suiteFolders } from '../lab/lib/repo.mjs';
import { buildState } from '../lab/lib/state.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Committed runs of retired suites (results/ in git).
const REASONING_RUN = '20261104T161946Z__reasoning__reasoning-sweep__e79a4d';
const AGENTIC_RUN = '20261104T165225Z__agentic__agentic-sweep__db0b84';
const rel = (...parts) => path.join(REPO, ...parts);

function tempRoot(t, runs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  for (const dir of ['configs', 'datasets', 'prompts', 'experiments']) fs.cpSync(rel(dir), path.join(root, dir), { recursive: true });
  for (const run of runs) fs.cpSync(rel('results', run), path.join(root, 'results', run), { recursive: true });
  return root;
}

test('an archived suite loads by its id, from datasets/archive, and no suite is named "archive"', (t) => {
  const root = tempRoot(t, []);
  for (const id of ['reasoning', 'coding', 'agentic', 'reasoning-hard', 'coding-hard', 'agentic-hard']) {
    assert.equal(suiteDir(root, id), path.join(root, 'datasets', 'archive', id), id);
    assert.equal(loadSuite(root, id).id, id);
    assert.ok(loadCases(root, id).length > 0, id);
  }
  assert.equal(suiteDir(root, 'smoke'), path.join(root, 'datasets', 'smoke'), 'a smoke stays where it is');
  assert.equal(suiteDir(root, 'archive'), null);
  assert.throws(() => loadSuite(root, 'archive'), /not found/);
  const ids = suiteFolders(root).map((item) => item.id);
  assert.ok(!suiteFolders(root).some((item) => item.id === 'archive'), 'the archive folder is not a suite');
  assert.ok(ids.includes('reasoning') && ids.includes('smoke'));
  assert.ok(suiteFolders(root).filter((item) => item.archived).length >= 6);
});

test('moving a suite does not change its identity: the hash covers the bytes, not the path', (t) => {
  const root = tempRoot(t, []);
  const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-archive-flat-'));
  t.after(() => fs.rmSync(moved, { recursive: true, force: true, maxRetries: 5 }));
  for (const id of ['reasoning', 'agentic']) fs.cpSync(path.join(root, 'datasets', 'archive', id), path.join(moved, 'datasets', id), { recursive: true });
  for (const id of ['reasoning', 'agentic']) assert.equal(loadSuite(root, id).sha256, loadSuite(moved, id).sha256, id);
});

test('an old committed run still loads its archived suite, builds state, validates and scores', (t) => {
  const root = tempRoot(t, [REASONING_RUN]);
  const manifest = readJson(path.join(root, 'results', REASONING_RUN, 'run.json'));
  assert.equal(manifest.suite.id, 'reasoning');
  const state = buildState(root, { validate: false });
  assert.equal(state.runs.length, 1);
  assert.ok(state.observations.length > 0);
  assert.ok(state.observations.every((item) => item.case_id.startsWith('reasoning-')));
  assert.ok(Object.keys(state.cases).length > 0, 'the cases of the archived suite are in the state');
  assert.ok(state.observations.some((item) => item.quality != null), 'its stored scores count');

  const { problems } = validateRepo(root);
  assert.deepEqual(problems, []);

  // Scoring reads the archived suite and gives the scores the run already holds.
  const scoresFile = path.join(root, 'results', REASONING_RUN, 'scores', 'final-answer@1.jsonl');
  const before = readJsonl(scoresFile).rows;
  const written = scoreRun(root, path.join(root, 'results', REASONING_RUN));
  assert.equal(written.length, 1);
  assert.deepEqual(readJsonl(scoresFile).rows, before);
});

test('an old agent run scores from the archived suite workspaces and checks', (t) => {
  const root = tempRoot(t, [AGENTIC_RUN]);
  const scoresFile = path.join(root, 'results', AGENTIC_RUN, 'scores', 'workspace-tests@1.jsonl');
  const before = readJsonl(scoresFile).rows;
  assert.ok(before.length > 0);
  scoreRun(root, path.join(root, 'results', AGENTIC_RUN));
  const after = readJsonl(scoresFile).rows;
  assert.deepEqual(after.map((row) => [row.case_id, row.repeat, row.value]), before.map((row) => [row.case_id, row.repeat, row.value]));
  assert.deepEqual(validateRepo(root).problems, []);
});

test('validate refuses a suite id that is in datasets and in datasets/archive', (t) => {
  const root = tempRoot(t, []);
  assert.deepEqual(validateRepo(root).problems, []);
  fs.cpSync(path.join(root, 'datasets', 'archive', 'reasoning'), path.join(root, 'datasets', 'reasoning'), { recursive: true });
  const { problems } = validateRepo(root);
  assert.ok(problems.some((line) => /suite "reasoning" is in datasets\/reasoning and in datasets\/archive\/reasoning/.test(line)), problems.join('\n'));
  assert.equal(suiteDir(root, 'reasoning'), path.join(root, 'datasets', 'reasoning'), 'the active folder wins until the duplicate is removed');
});

test('validate does not take datasets/archive for a suite', (t) => {
  const root = tempRoot(t, []);
  const before = validateRepo(root).counts.suites;
  assert.equal(before, suiteFolders(root).length);
  fs.writeFileSync(path.join(root, 'datasets', 'archive', 'suite.yaml'), 'id: archive\nversion: "1"\n');
  assert.ok(validateRepo(root).problems.some((line) => /is the folder of retired suites, not a suite/.test(line)));
});

test('an archived suite takes no new case', (t) => {
  const root = tempRoot(t, []);
  assert.throws(() => newCase(root, 'reasoning', 'another', { log: () => {} }), /archived/);
});

test('an archived experiment is validated and its plan still builds', async (t) => {
  const root = tempRoot(t, []);
  const { planExperiment } = await import('../lab/commands/run.mjs');
  for (const name of ['reasoning-sweep', 'coding-sweep', 'agentic-sweep', 'reasoning-hard-sweep', 'coding-hard-sweep', 'agentic-hard-sweep', 'opencode-reasoning', 'opencode-coding', 'opencode-agentic', 'smoke-opencode', 'smoke-command-code']) {
    const file = path.join(root, 'experiments', 'archive', `${name}.yaml`);
    assert.ok(fs.existsSync(file), name);
    assert.ok(planExperiment(root, file).suite.id, name);
  }
  const { counts } = validateRepo(root);
  assert.ok(counts.experiments >= 15);
});
