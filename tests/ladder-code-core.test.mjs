// The "core" part of the ladder-code suite (tiers 1 to 4) proves itself without a model call.
//
// - The quota per tier holds, every case fits the tier table, and each case stays small.
// - Folded cases (tiers 1 to 3) keep the task text and tests of their origin case. The
//   origin is pinned by a hash, so the check still works after the old suites move.
// - Every reference solution passes its hidden tests through the real js-function
//   evaluator, and the efficiency references stay far inside the sandbox limits.
// - Every efficiency case has a naive solution that agrees with the reference on all small
//   tests and times out on the huge ones.
// - Every case has a plausible wrong solution that scores below 1 but above 0; an empty
//   function scores 0.
// - The spec names every edge case a test checks.
//
// Solutions live in tests/fixtures/ladder-code-solutions/core/:
//   <case_id>.mjs         reference
//   <case_id>.naive.mjs   slow but correct (efficiency cases only)
//   <case_id>.wrong.mjs   plausible mistake

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEvaluator } from '../lab/evaluators/index.mjs';
import { caseProblems, loadDefinitions, loadLadder } from '../lab/lib/ladder.mjs';
import { buildCases, SOLUTIONS } from '../datasets/ladder-code/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CORE_DEFS = path.join(ROOT, 'datasets', 'ladder-code', 'defs', 'core');
const CORE_SOLUTIONS = path.join(SOLUTIONS, 'core');
const EVALUATOR_URL = pathToFileURL(path.join(ROOT, 'lab', 'evaluators', 'index.mjs')).href;

// The sandbox gives each test 2 s and the whole process 30 s (lab/evaluators).
const TEST_LIMIT_MS = 2000;
const PROCESS_LIMIT_MS = 30000;

const QUOTA = { 1: 2, 2: 4, 3: 5, 4: 7 };

// Folded cases: the origin case_id, the number of origin tests (they come first in the new
// case, in the same order), and the sha256 of the origin input and those tests.
const ORIGINS = {
  'coding-palindrome': { slug: 'palindrome', tests: 5, sha256: 'b01bb253c7245e55471805d5618422b94be562963dbcfac103111e5597984900' },
  'coding-primes': { slug: 'primes', tests: 4, sha256: '2b2172c106562310d7173d75491e98d54ed4f60ccf0d7e3b8988ba566af04e2f' },
  'coding-roman': { slug: 'roman', tests: 6, sha256: '26488ffca2ed3e09ebb2e0b4ac11a715e65e40377762bf3254027c315baf4394' },
  'coding-merge-intervals': { slug: 'merge-intervals', tests: 5, sha256: 'ce516be5c02f5e69c3d629f0e87b28334e1a1ee15827346497b4c2c42ef82781' },
  'coding-duration': { slug: 'duration', tests: 5, sha256: '4ffd1b714a96726591c83737a4fad87c4583e92ffaa5c8b5f093b1d3b4d57c98' },
  'coding-lcs': { slug: 'lcs', tests: 5, sha256: '34f8d5221f8e420ea2b6e3b3ddcdd7915af4db259280fffdea3e3d68c2e0b6c9' },
  'coding-hard-round-robin': { slug: 'round-robin', tests: 16, sha256: 'b2d7d0daa99ef7155e2d1744d0c36ea1cd36fb0137abcb7abc5c17af31fad958' },
  'coding-hard-interval-union': { slug: 'interval-union', tests: 20, sha256: '7f83c46589d4833aa0720b19d4197c4a601572cc5121476898e2a6e5ca6c2016' },
  'coding-hard-coupon-path': { slug: 'coupon-path', tests: 18, sha256: '831f0e2ad32dc40bac99879c4d40dde88fa0631d03874934ad06546922e225d4' },
  'coding-hard-not-divisible': { slug: 'not-divisible', tests: 16, sha256: '72f61c11afb2320163ffd3b8ccf1519419dfb40de50ab4b2b1628032e18c4a1f' },
  'coding-hard-rect-coverage': { slug: 'rect-coverage', tests: 20, sha256: '1dd0670539ab0c5e703e7d29e2de20d3be277c6f62a5cf667c9ac4e738a09934' },
};

const slugs = (await loadDefinitions(CORE_DEFS)).map((def) => def.slug);
const cases = (await buildCases()).filter((item) => slugs.includes(item.case_id.slice('ladder-code-'.length)));
const efficiency = cases.filter((item) => item.tags.includes('efficiency'));
const tierOf = (item) => item.metadata.tier.level;
const isHuge = (label) => label.startsWith('huge');
const jsFunction = getEvaluator('js-function', '1');
const solutionText = (id, kind = '') => fs.readFileSync(path.join(CORE_SOLUTIONS, `${id}${kind}.mjs`), 'utf8');
const wrap = (code) => '```js\n' + code + '\n```';
const scoreHere = (testCase, code) => jsFunction.score({ raw: { response: { text: wrap(code) } }, testCase });

// CPU time of this process in ms (user + system). Other processes cannot inflate it, so a margin
// assertion gives the same verdict on a busy machine as on an idle one. A wall clock would not.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};

/**
 * CPU ms that the reference needs for each test of a case, measured here in its own vm context
 * (not in the sandbox). The vm timeout is only a backstop against a hang, not the verdict.
 */
function referenceCpu(item) {
  const source = solutionText(item.case_id);
  return item.expected.tests.map((one) => {
    const context = vm.createContext({});
    vm.runInContext(source, context);
    context.__fn = vm.runInContext(item.input.name, context);
    context.__args = JSON.stringify(one.args);
    const started = cpuMs();
    vm.runInContext('JSON.stringify(__fn(...JSON.parse(__args)))', context, { timeout: PROCESS_LIMIT_MS });
    return cpuMs() - started;
  });
}

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

test('the quota holds: 2 / 4 / 5 / 7 cases in tiers 1 to 4, with at least 3 efficiency cases in tier 4', () => {
  assert.equal(cases.length, 18);
  assert.equal(new Set(cases.map((item) => item.case_id)).size, 18, 'duplicate case_id');
  for (const [level, want] of Object.entries(QUOTA)) {
    assert.equal(cases.filter((item) => tierOf(item) === Number(level)).length, want, `tier ${level}`);
  }
  assert.ok(efficiency.filter((item) => tierOf(item) === 4).length >= 3, 'tier 4 needs at least 3 efficiency cases');
  assert.ok(efficiency.every((item) => tierOf(item) >= 3), 'efficiency cases belong to tier 3 or 4');
});

test('every case fits configs/ladder.yaml, has the prompt variables, and stays small', () => {
  const ladder = loadLadder(ROOT);
  for (const item of cases) {
    assert.deepEqual(caseProblems(item, ladder), [], item.case_id);
    assert.match(item.case_id, /^ladder-code-[a-z0-9-]+$/);
    assert.deepEqual(Object.keys(item.input), ['name', 'signature', 'task'], `${item.case_id}: input holds the prompt variables`);
    assert.ok(item.input.signature.startsWith(`${item.input.name}(`), `${item.case_id}: signature starts with the function name`);
    assert.ok(item.input.task.length > 80, `${item.case_id}: the spec is complete`);
    const size = JSON.stringify(item).length;
    assert.ok(size < 50000, `${item.case_id}: ${size} bytes in cases.jsonl, expected under 50000`);
    const count = item.expected.tests.length;
    if (tierOf(item) <= 2) assert.ok(count >= 5, `${item.case_id}: ${count} tests, expected 5 or more`);
    else assert.ok(count >= 8 && count <= 50, `${item.case_id}: ${count} tests, expected 8 to 50`);
  }
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
    const wanted = tierOf(item) <= 2 ? 2 : 3;
    assert.ok(Object.keys(edges).length >= wanted, `${item.case_id}: the spec should name at least ${wanted} edge cases`);
  }
});

test('folded cases keep the task text and tests of their origin; new cases (tier 4) have none', () => {
  const byOrigin = new Map(cases.filter((item) => item.metadata.tier.origin).map((item) => [item.metadata.tier.origin, item]));
  assert.deepEqual([...byOrigin.keys()].sort(), Object.keys(ORIGINS).sort(), 'the folded origins');
  for (const [origin, { slug, tests, sha256 }] of Object.entries(ORIGINS)) {
    const item = byOrigin.get(origin);
    assert.equal(item.case_id, `ladder-code-${slug}`);
    assert.ok(tierOf(item) <= 3, `${origin}: folds into tier 1 to 3`);
    assert.ok(item.expected.tests.length >= tests, `${item.case_id}: fewer tests than its origin`);
    const kept = JSON.stringify({ input: item.input, tests: item.expected.tests.slice(0, tests) });
    assert.equal(crypto.createHash('sha256').update(kept).digest('hex'), sha256, `${item.case_id}: the first ${tests} tests and the input differ from ${origin}`);
  }
  for (const item of cases.filter((one) => tierOf(one) === 4)) assert.equal(item.metadata.tier.origin, undefined, `${item.case_id}: a new task has no origin`);
});

test('the solution folder holds exactly a reference and a wrong solution per case, and a naive one per efficiency case', () => {
  const want = new Set();
  for (const item of cases) {
    want.add(`${item.case_id}.mjs`);
    want.add(`${item.case_id}.wrong.mjs`);
    if (item.tags.includes('efficiency')) want.add(`${item.case_id}.naive.mjs`);
  }
  assert.deepEqual(fs.readdirSync(CORE_SOLUTIONS).sort(), [...want].sort());
});

test('every efficiency case has at least two huge tests, after small ones', () => {
  for (const item of efficiency) {
    const labels = item.metadata.test_edges;
    const huge = labels.filter(isHuge);
    assert.ok(huge.length >= 2, `${item.case_id}: needs two huge tests`);
    assert.ok(labels.slice(0, 3).every((label) => !isHuge(label)), `${item.case_id}: the first tests are small`);
    assert.ok(Object.keys(item.metadata.edges).some(isHuge), `${item.case_id}: the spec names the huge limit`);
  }
});

test('every reference solution scores 1 through the real evaluator, well inside the time limits', () => {
  for (const item of cases) {
    const score = scoreHere(item, solutionText(item.case_id));
    assert.equal(score.value, 1, `${item.case_id}: ${failing(score).slice(0, 3).join(' | ')} ${score.details.error ?? ''}`);
    // CPU time, not wall time: the verdict must not depend on how busy the machine is.
    const took = referenceCpu(item).reduce((sum, ms) => sum + ms, 0);
    assert.ok(took < PROCESS_LIMIT_MS / 3, `${item.case_id}: the reference needs ${took.toFixed(0)} ms of CPU for all tests`);
  }
});

test('the efficiency references need at most half of the per-test limit on every test', () => {
  for (const item of efficiency) {
    const slowest = Math.max(0, ...referenceCpu(item));
    assert.ok(slowest < TEST_LIMIT_MS / 2,`${item.case_id}: slowest test ${slowest.toFixed(0)} ms`);
  }
});

test('a naive solution agrees on every small test and fails the huge ones of every efficiency case', { timeout: 600000 }, async () => {
  // All small tests, and two huge ones: that is enough to time the naive code out.
  const jobs = efficiency.map((item) => async () => {
    const labelled = item.expected.tests.map((one, index) => ({ one, label: item.metadata.test_edges[index] }));
    const small = labelled.filter(({ label }) => !isHuge(label));
    const huge = labelled.filter(({ label }) => isHuge(label)).slice(0, 2);
    const subset = { ...item, expected: { tests: [...small, ...huge].map(({ one }) => one) } };
    const score = await scoreInChild(subset, solutionText(item.case_id, '.naive'));
    return { item, score, smallCount: small.length };
  });
  for (const { item, score, smallCount } of await pool(jobs, 4)) {
    const results = score.details.results;
    assert.ok(results.slice(0, smallCount).every((one) => one.ok), `${item.case_id}: the naive solution must agree on the small tests: ${failing(score).join(' | ')}`);
    assert.ok(results.slice(smallCount).every((one) => !one.ok), `${item.case_id}: the naive solution must fail the huge tests`);
    assert.ok(score.value < 1 && score.value > 0, `${item.case_id}: naive score ${score.value}`);
  }
});

test('a plausible wrong solution scores below 1, but above 0, for every case', { timeout: 600000 }, async () => {
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
