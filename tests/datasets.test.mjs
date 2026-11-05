// The shipped suites prove themselves: ids are unique, the reasoning generator is
// stable and matches cases.jsonl, every coding case passes its reference solution
// through the real js-function evaluator, and every agent task fails on its
// starter and passes on its known-good solution through the real hidden check.
// No model calls.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEvaluator, loadCheck, runWorkspaceCheck } from '../lab/evaluators/index.mjs';
import { readJsonl } from '../lab/lib/fsutil.mjs';
import { snapshotWorkspace } from '../lab/lib/workspace.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATASETS = path.join(HERE, '..', 'datasets');
const casesOf = (suite) => readJsonl(path.join(DATASETS, suite, 'cases.jsonl')).rows;
const SUITES = fs.readdirSync(DATASETS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

test('case_ids are unique in every suite and start with the suite id', () => {
  for (const suite of SUITES) {
    const ids = casesOf(suite).map((item) => item.case_id);
    assert.equal(new Set(ids).size, ids.length, `${suite}: duplicate case_id`);
    for (const id of ids) assert.ok(id.startsWith(`${suite}-`), `${id} should start with ${suite}-`);
  }
});

test('the reasoning generator is deterministic and its output is what cases.jsonl holds', () => {
  const generator = path.join(DATASETS, 'reasoning', 'generate.mjs');
  const run = () => spawnSync(process.execPath, [generator], { encoding: 'utf8' });
  const first = run();
  const second = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout, 'two runs must print the same lines');
  assert.ok(!first.stdout.includes('\r'), 'LF only');

  const generated = first.stdout.split('\n').filter(Boolean);
  assert.ok(generated.length >= 25, `expected at least 25 generated cases, got ${generated.length}`);
  const parsed = generated.map((line) => JSON.parse(line));
  assert.equal(new Set(parsed.map((item) => item.case_id)).size, parsed.length, 'generated ids are unique');
  for (const item of parsed) {
    assert.ok(typeof item.expected === 'number' || typeof item.expected === 'string', `${item.case_id}: expected must be a number or a string`);
    assert.ok(Number.isFinite(item.expected) || typeof item.expected === 'string', `${item.case_id}: finite answer`);
    assert.ok(item.tags.length > 0, `${item.case_id}: tags`);
    assert.ok(item.input.question.length > 40, `${item.case_id}: question`);
  }

  const lines = fs.readFileSync(path.join(DATASETS, 'reasoning', 'cases.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean);
  assert.deepEqual(lines.slice(-generated.length), generated, 'the last lines of cases.jsonl must be the generator output, byte for byte');
  const handWritten = lines.slice(0, -generated.length).map((line) => JSON.parse(line).case_id);
  for (const item of parsed) assert.ok(!handWritten.includes(item.case_id), `${item.case_id} also appears among the hand-written cases`);
});

const REFERENCES = path.join(HERE, 'fixtures', 'coding-solutions');

test('every coding case has a reference solution that passes its hidden tests', () => {
  const jsFunction = getEvaluator('js-function', '1');
  const cases = casesOf('coding');
  assert.ok(cases.length >= 18, 'the suite should hold the 8 original and 12 new cases');
  for (const testCase of cases) {
    const file = path.join(REFERENCES, `${testCase.case_id}.mjs`);
    assert.ok(fs.existsSync(file), `${testCase.case_id}: missing ${path.relative(HERE, file)}`);
    const text = '```js\n' + fs.readFileSync(file, 'utf8') + '\n```';
    const score = jsFunction.score({ raw: { response: { text } }, testCase });
    assert.equal(score.value, 1, `${testCase.case_id}: ${JSON.stringify(score.details.results.filter((item) => !item.ok))}`);
    assert.ok(testCase.expected.tests.length >= 4, `${testCase.case_id}: at least 4 hidden tests`);
  }
});

test('a function that always returns null does not pass any coding case', () => {
  const jsFunction = getEvaluator('js-function', '1');
  for (const testCase of casesOf('coding')) {
    const text = '```js\nfunction ' + testCase.input.name + '() { return null; }\n```';
    assert.ok(jsFunction.score({ raw: { response: { text } }, testCase }).value < 1, `${testCase.case_id}: a stub passes`);
  }
});

const SOLUTIONS = path.join(HERE, 'fixtures', 'agentic-solutions');

// Lays `overlay` (a folder or null) over a copy of the starter, stores it like the
// runner does, and runs the hidden check on it.
function checkWith(name, overlay, tmp) {
  const fixtureDir = path.join(DATASETS, 'agentic', 'workspaces', name);
  const workDir = path.join(tmp, 'work');
  fs.cpSync(fixtureDir, workDir, { recursive: true });
  if (overlay) fs.cpSync(overlay, workDir, { recursive: true });
  const runDir = path.join(tmp, 'run');
  // In a real run the run folder exists before the snapshot (lab/lib/runwrite.mjs needs it).
  fs.mkdirSync(runDir, { recursive: true });
  const artifact = snapshotWorkspace({ fixtureDir, workDir, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-05T00:00:00Z' });
  return runWorkspaceCheck({ fixtureDir, check: loadCheck(path.join(DATASETS, 'agentic', 'checks'), name), runDir, manifestPath: artifact.path });
}

test('every agent task fails on its starter, passes on its known-good solution, and its probes match expected.json', async (t) => {
  const cases = casesOf('agentic');
  assert.ok(cases.length >= 6, 'the suite should hold the 3 original and 3 new tasks');
  for (const testCase of cases) {
    const name = testCase.input.workspace;
    assert.equal(testCase.expected.check, name, `${testCase.case_id}: check and workspace share a name`);
    assert.ok(fs.existsSync(path.join(SOLUTIONS, name)), `${testCase.case_id}: missing tests/fixtures/agentic-solutions/${name}`);

    const probeFile = path.join(DATASETS, 'agentic', 'checks', name, 'probe.mjs');
    const { probes } = await import(pathToFileURL(probeFile).href);
    const wanted = Object.keys(loadCheck(path.join(DATASETS, 'agentic', 'checks'), name).probes);
    assert.deepEqual(probes.map((probe) => probe.name).sort(), wanted.sort(), `${name}: probe names and expected.json keys differ`);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-datasets-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const starter = checkWith(name, null, path.join(tmp, 'starter'));
    assert.ok(starter.results.some((item) => !item.ok), `${name}: the unchanged starter must fail the check`);
    const solved = checkWith(name, path.join(SOLUTIONS, name), path.join(tmp, 'solved'));
    assert.deepEqual(solved.results.filter((item) => !item.ok), [], `${name}: the known-good solution must pass every test`);
    assert.equal(solved.error, undefined, `${name}: ${solved.error}`);
  }
});
