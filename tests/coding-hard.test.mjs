// The coding-hard suite proves itself without a model call.
//
// - Every reference solution passes its hidden tests through the real js-function
//   evaluator, and the efficiency cases stay far inside the sandbox time limits.
// - Every efficiency case has a naive solution that agrees with the reference on
//   small inputs and fails (times out) on the huge ones.
// - Every case has a plausible but wrong solution that scores below 1; an empty
//   function scores 0.
// - Ids and tests are unique, the spec names every edge case a test checks, and
//   cases.jsonl is exactly what datasets/coding-hard/generate.mjs prints.
//
// The solutions live in tests/fixtures/coding-hard-solutions/:
//   <case_id>.mjs         reference
//   <case_id>.naive.mjs   brute force (efficiency cases only)
//   <case_id>.wrong.mjs   plausible mistake

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEvaluator } from '../lab/evaluators/index.mjs';
import { readJsonl } from '../lab/lib/fsutil.mjs';
import { buildText } from '../datasets/coding-hard/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = path.join(HERE, '..', 'datasets', 'coding-hard');
const SOLUTIONS = path.join(HERE, 'fixtures', 'coding-hard-solutions');
const EVALUATOR_URL = pathToFileURL(path.join(HERE, '..', 'lab', 'evaluators', 'index.mjs')).href;

// The sandbox gives each test 2 s and the whole process 30 s (lab/evaluators).
const TEST_LIMIT_MS = 2000;
const PROCESS_LIMIT_MS = 30000;

const cases = readJsonl(path.join(SUITE_DIR, 'cases.jsonl')).rows;
const efficiency = cases.filter((item) => item.tags[0] === 'efficiency');
const jsFunction = getEvaluator('js-function', '1');
const solutionText = (id, kind = '') => fs.readFileSync(path.join(SOLUTIONS, `${id}${kind}.mjs`), 'utf8');
const wrap = (code) => '```js\n' + code + '\n```';
const scoreHere = (testCase, code) => jsFunction.score({ raw: { response: { text: wrap(code) } }, testCase });

// Scores in a child process, so several slow solutions run side by side.
function scoreInChild(testCase, code) {
  const script = `
    const { getEvaluator } = await import(process.env.EVALUATOR_URL);
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const { testCase, text } = JSON.parse(input);
    const score = getEvaluator('js-function', '1').score({ raw: { response: { text } }, testCase });
    process.stdout.write(JSON.stringify(score));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, EVALUATOR_URL }, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`scorer exited with ${code}: ${err}`));
      else resolve(JSON.parse(out));
    });
    child.stdin.end(JSON.stringify({ testCase, text: wrap(code) }));
  });
}

// Runs the jobs with at most `size` at a time.
async function pool(jobs, size) {
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) {
      const index = next;
      next += 1;
      results[index] = await jobs[index]();
    }
  }));
  return results;
}

const failing = (score) => score.details.results.map((item, index) => ({ index, item })).filter(({ item }) => !item.ok).map(({ index, item }) => `#${index} ${JSON.stringify(item).slice(0, 300)}`);

test('the suite holds 20 cases with unique ids, the coding prompt variables, and the right tags', () => {
  assert.equal(cases.length, 20);
  const ids = cases.map((item) => item.case_id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate case_id');
  const kinds = new Set();
  for (const item of cases) {
    assert.match(item.case_id, /^coding-hard-[a-z0-9-]+$/);
    assert.deepEqual(Object.keys(item.input).sort(), ['name', 'signature', 'task'], `${item.case_id}: input holds the prompt variables`);
    assert.ok(item.input.signature.startsWith(`${item.input.name}(`), `${item.case_id}: signature starts with the function name`);
    assert.ok(item.input.task.length > 150, `${item.case_id}: the spec is complete`);
    assert.equal(item.tags.length, 2, `${item.case_id}: tags are [kind, "hard"]`);
    assert.equal(item.tags[1], 'hard');
    kinds.add(item.tags[0]);
    const count = item.expected.tests.length;
    assert.ok(count >= 8 && count <= 20, `${item.case_id}: ${count} tests, expected 8 to 20`);
  }
  assert.deepEqual([...kinds].sort(), ['efficiency', 'geometry', 'graph', 'numeric', 'parsing', 'simulation']);
  assert.ok(efficiency.length >= 6, 'the suite needs several efficiency cases');
});

test('cases.jsonl is exactly what generate.mjs prints, with LF line endings', async () => {
  const text = fs.readFileSync(path.join(SUITE_DIR, 'cases.jsonl'), 'utf8');
  assert.equal(await buildText(), text);
  assert.ok(!text.includes('\r'), 'LF only');
});

test('the tests of a case are unique, and expected values are JSON the sandbox can produce', () => {
  for (const item of cases) {
    const keys = item.expected.tests.map((one) => JSON.stringify(one.args));
    assert.equal(new Set(keys).size, keys.length, `${item.case_id}: duplicate test arguments`);
    for (const one of item.expected.tests) {
      assert.ok(Array.isArray(one.args), `${item.case_id}: args is an array`);
      assert.ok('returns' in one, `${item.case_id}: every test has an expected value`);
      assert.deepEqual(JSON.parse(JSON.stringify(one.returns)), one.returns, `${item.case_id}: expected value survives JSON`);
    }
  }
});

test('the spec of every case names each edge case that one of its tests checks', () => {
  for (const item of cases) {
    const { edges, test_edges: testEdges } = item.metadata;
    const task = item.input.task.toLowerCase();
    assert.equal(testEdges.length, item.expected.tests.length, `${item.case_id}: one edge label per test`);
    const phrases = Object.values(edges);
    assert.equal(new Set(phrases).size, phrases.length, `${item.case_id}: each edge has its own phrase`);
    for (const [name, phrase] of Object.entries(edges)) {
      assert.ok(task.includes(phrase.toLowerCase()), `${item.case_id}: the spec does not contain the phrase for "${name}": ${phrase}`);
      assert.ok(testEdges.includes(name), `${item.case_id}: no test checks the declared edge "${name}"`);
    }
    for (const label of testEdges) assert.ok(label === 'basic' || label in edges, `${item.case_id}: a test checks "${label}", which the spec does not name`);
    assert.ok(Object.keys(edges).length >= 3, `${item.case_id}: the spec should name several edge cases`);
  }
});

test('every reference solution scores 1 through the real evaluator, well inside the time limits', () => {
  for (const item of cases) {
    const started = Date.now();
    const score = scoreHere(item, solutionText(item.case_id));
    const took = Date.now() - started;
    assert.equal(score.value, 1, `${item.case_id}: ${failing(score).slice(0, 3).join(' | ')} ${score.details.error ?? ''}`);
    assert.ok(took < PROCESS_LIMIT_MS / 3, `${item.case_id}: the reference run took ${took} ms`);
  }
});

test('the efficiency references need less than a third of the per-test limit on every test', () => {
  for (const item of efficiency) {
    const source = solutionText(item.case_id);
    let slowest = 0;
    for (const one of item.expected.tests) {
      const context = vm.createContext({});
      vm.runInContext(source, context);
      context.__fn = vm.runInContext(item.input.name, context);
      context.__args = JSON.stringify(one.args);
      const started = performance.now();
      vm.runInContext('JSON.stringify(__fn(...JSON.parse(__args)))', context, { timeout: TEST_LIMIT_MS });
      slowest = Math.max(slowest, performance.now() - started);
    }
    assert.ok(slowest < TEST_LIMIT_MS / 3, `${item.case_id}: slowest test ${slowest.toFixed(0)} ms`);
  }
});

test('a naive solution agrees on small inputs and fails the huge ones of every efficiency case', { timeout: 300000 }, async () => {
  // The first three tests of each efficiency case are small; two huge ones are enough to time the naive code out.
  const jobs = efficiency.map((item) => async () => {
    const huge = item.expected.tests.map((one, index) => ({ one, index })).filter(({ index }) => item.metadata.test_edges[index].startsWith('huge')).slice(0, 2);
    assert.equal(huge.length, 2, `${item.case_id}: needs two huge tests`);
    const subset = { ...item, expected: { tests: [...item.expected.tests.slice(0, 3), ...huge.map(({ one }) => one)] } };
    const score = await scoreInChild(subset, solutionText(item.case_id, '.naive'));
    return { item, score };
  });
  for (const { item, score } of await pool(jobs, 4)) {
    const results = score.details.results;
    assert.ok(results.slice(0, 3).every((one) => one.ok), `${item.case_id}: the naive solution must agree on the small tests: ${failing(score).join(' | ')}`);
    assert.ok(results.slice(3).every((one) => !one.ok), `${item.case_id}: the naive solution must fail the huge tests`);
    assert.ok(score.value < 1 && score.value > 0, `${item.case_id}: naive score ${score.value}`);
  }
});

test('a plausible wrong solution scores below 1 for every case', { timeout: 300000 }, async () => {
  const jobs = cases.map((item) => async () => ({ item, score: await scoreInChild(item, solutionText(item.case_id, '.wrong')) }));
  for (const { item, score } of await pool(jobs, 4)) {
    assert.ok(score.value < 1, `${item.case_id}: the wrong solution passes every test`);
    assert.ok(score.details.passed_tests > 0, `${item.case_id}: the wrong solution should be plausible, but it fails every test`);
  }
});

test('an empty function scores 0 and a function that returns null does not pass any case', () => {
  for (const item of cases) {
    const empty = scoreHere(item, `function ${item.input.name}() {}`);
    assert.equal(empty.value, 0, `${item.case_id}: an empty function scored ${empty.value}`);
    const stub = scoreHere(item, `function ${item.input.name}() { return null; }`);
    assert.ok(stub.value < 1, `${item.case_id}: a null stub passes`);
  }
});
