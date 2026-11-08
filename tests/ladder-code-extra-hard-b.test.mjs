// The extra-hard-b part of the ladder-code suite (tier 4, round 2) proves itself without a model call.
//
// - Every reference solution passes its hidden tests through the real js-function@2
//   evaluator, and the references stay far inside the sandbox limits (CPU time, never wall time).
// - Every efficiency case is mostly huge tests, so a naive solution that agrees with the
//   reference on the small inputs but times out on the huge ones scores at most 0.35.
//   LADDER_NAIVE_PROOF=1 also runs the naive solution of each case on its smallest huge test
//   without a limit and asserts that it needs at least 20 s of CPU (ten times the 2 s limit).
// - Every case has a plausible but wrong solution that scores above 0 and at most 0.5; an empty
//   function scores 0.
// - The task text names every edge case a test checks, and each case is small.
// - Every case carries hand-derived tests: tests whose `returns` stands in the definition (worked
//   out from the task text, not computed by the reference). The reference has to agree with them.
//
// The solutions live in tests/fixtures/ladder-code-solutions/extra-hard-b/:
//   <case_id>.mjs         reference
//   <case_id>.naive.mjs   correct on small inputs, too slow on huge ones (efficiency cases)
//   <case_id>.wrong.mjs   plausible mistake

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getEvaluator } from '../lab/evaluators/index.mjs';
import { buildCases } from '../datasets/ladder-code/generate.mjs';
import { loadDefinitions } from '../lab/lib/ladder.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFS = path.join(HERE, '..', 'datasets', 'ladder-code', 'defs', 'extra-hard-b');
const SOLUTIONS = path.join(HERE, 'fixtures', 'ladder-code-solutions', 'extra-hard-b');
const EVALUATOR_URL = pathToFileURL(path.join(HERE, '..', 'lab', 'evaluators', 'index.mjs')).href;

// js-function@2 (lab/evaluators) gives each test 2 s of CPU time and all tests of a case 30 s of CPU time.
const TEST_LIMIT_MS = 2000;
const PROCESS_LIMIT_MS = 30000;
// The reference solutions of one case together, and the best score a correct but slow solution may reach.
const CASE_REFERENCE_LIMIT_MS = 12000;
const NAIVE_SCORE_LIMIT = 0.35;
// A plausible wrong solution has to fail at least half of the tests.
const WRONG_SCORE_LIMIT = 0.5;
// A slow answer loses the huge tests of an efficiency case by design; a timed-out test costs 2 s of the 30 s
// the sandbox process gets, so the huge tests together may take at most three quarters of it.
const EFFICIENCY_BUDGET_FRACTION = 0.75;
// A naive solution needs at least ten times the per-test limit on this machine.
const NAIVE_CPU_PROOF_MS = 10 * TEST_LIMIT_MS;

const slugs = fs.readdirSync(DEFS).filter((name) => name.endsWith('.mjs') && !name.startsWith('_')).map((name) => name.slice(0, -4)).sort();
const ids = new Set(slugs.map((slug) => `ladder-code-${slug}`));
const cases = (await buildCases()).filter((item) => ids.has(item.case_id));
const efficiency = cases.filter((item) => item.tags.includes('efficiency'));
const specs = cases.filter((item) => item.tags.includes('spec'));
const defs = new Map((await loadDefinitions(DEFS)).map((def) => [`ladder-code-${def.slug}`, def]));
const jsFunction = getEvaluator('js-function', '2');
const solutionText = (id, kind = '') => fs.readFileSync(path.join(SOLUTIONS, `${id}${kind}.mjs`), 'utf8');
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
    const score = getEvaluator('js-function', '2').score({ raw: { response: { text } }, testCase });
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

// Runs one test of a naive solution in a child process and reports its CPU time in ms. A naive solution that is
// still running after NAIVE_PROOF_WALL_MS of wall time is stopped, and the CPU time it has used so far is reported
// (it is a lower bound of what it would need).
const NAIVE_PROOF_WALL_MS = 90000;
function naiveCpuInChild(source, name, args) {
  const script = `
    const vm = require('node:vm');
    const { source, name, args, wall } = JSON.parse(process.env.PROOF);
    const context = vm.createContext({});
    vm.runInContext(source, context);
    const before = process.cpuUsage();
    try {
      vm.runInContext(name + '(...' + JSON.stringify(args) + ')', context, { timeout: wall });
    } catch (error) {
      if (!/timed out/.test(String(error && error.message))) throw error;
    }
    const used = process.cpuUsage(before);
    process.stdout.write(String((used.user + used.system) / 1000));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { env: { ...process.env, PROOF: JSON.stringify({ source, name, args, wall: NAIVE_PROOF_WALL_MS }) }, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`naive proof exited with ${code}: ${err}`));
      else resolve(Number(out));
    });
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

test('the extra-hard-b part holds 7 tier 4 cases: 3 efficiency, 4 precise-spec, all with unique ids', () => {
  assert.equal(slugs.length, 7, 'one definition file per case');
  assert.equal(cases.length, 7);
  assert.equal(new Set(cases.map((item) => item.case_id)).size, 7, 'duplicate case_id');
  assert.equal(efficiency.length, 3);
  assert.equal(specs.length, 4);
  for (const item of cases) {
    assert.match(item.case_id, /^ladder-code-[a-z0-9-]+$/);
    assert.equal(item.metadata.tier.level, 4, `${item.case_id}: tier 4`);
    assert.equal(item.metadata.tier.name, 'extra-hard');
    assert.equal(item.tags[0], 'tier-4-extra-hard');
    const minutes = item.metadata.tier.human_minutes;
    assert.ok(minutes > 30 && minutes <= 120, `${item.case_id}: ${minutes} min is outside 30..120`);
    assert.ok(item.metadata.tier.basis.length >= 40, `${item.case_id}: the basis should say how the time was estimated`);
    assert.deepEqual(Object.keys(item.input).sort(), ['name', 'signature', 'task'], `${item.case_id}: input holds the prompt variables`);
    assert.ok(item.input.signature.startsWith(`${item.input.name}(`), `${item.case_id}: signature starts with the function name`);
    assert.ok(item.input.task.length > 400, `${item.case_id}: the task text is complete`);
    assert.equal(item.tags.length, 3, `${item.case_id}: tags are [tier, kind, topic]`);
    const count = item.expected.tests.length;
    assert.ok(count >= 12 && count <= 20, `${item.case_id}: ${count} tests, expected 12 to 20`);
  }
});

test('each case stays under 50 KB of JSON, as stored in cases.jsonl', () => {
  for (const item of cases) {
    const bytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
    assert.ok(bytes < 50 * 1024, `${item.case_id}: ${bytes} bytes`);
  }
});

test('the tests of a case are unique, and expected values are JSON the sandbox can produce', () => {
  for (const item of cases) {
    const keys = item.expected.tests.map((one) => JSON.stringify(one.args));
    assert.equal(new Set(keys).size, keys.length, `${item.case_id}: duplicate test arguments`);
    for (const one of item.expected.tests) {
      assert.ok(Array.isArray(one.args), `${item.case_id}: args is an array`);
      assert.ok('returns' in one && one.returns !== undefined, `${item.case_id}: every test has an expected value`);
      assert.deepEqual(JSON.parse(JSON.stringify(one.returns)), one.returns, `${item.case_id}: expected value survives JSON`);
      assert.ok(JSON.stringify(one.returns).length < 3000, `${item.case_id}: the expected value is short enough for the sandbox output`);
    }
  }
});

test('the task text names every edge case that one of its tests checks', () => {
  for (const item of cases) {
    const { edges, test_edges: testEdges } = item.metadata;
    const task = item.input.task.toLowerCase();
    assert.equal(testEdges.length, item.expected.tests.length, `${item.case_id}: one edge label per test`);
    const phrases = Object.values(edges);
    assert.equal(new Set(phrases).size, phrases.length, `${item.case_id}: each edge has its own phrase`);
    for (const [name, phrase] of Object.entries(edges)) {
      assert.ok(task.includes(phrase.toLowerCase()), `${item.case_id}: the task text does not contain the phrase for "${name}": ${phrase}`);
      assert.ok(testEdges.includes(name), `${item.case_id}: no test checks the declared edge "${name}"`);
    }
    for (const label of testEdges) assert.ok(label === 'basic' || label in edges, `${item.case_id}: a test checks "${label}", which the task text does not name`);
    assert.ok(Object.keys(edges).length >= 3, `${item.case_id}: the task text should name several edge cases`);
  }
});

test('every reference solution scores 1 through the real evaluator, well inside the time limits', () => {
  for (const item of cases) {
    const score = scoreHere(item, solutionText(item.case_id));
    assert.equal(score.value, 1, `${item.case_id}: ${failing(score).slice(0, 3).join(' | ')} ${score.details.error ?? ''}`);
    const took = referenceCpu(item).reduce((sum, ms) => sum + ms, 0);
    assert.ok(took < PROCESS_LIMIT_MS / 3, `${item.case_id}: the reference needs ${took.toFixed(0)} ms of CPU for all tests`);
  }
});

test('every reference needs less than a third of the per-test limit on every test, and under 12 s for a whole case', () => {
  for (const item of cases) {
    const times = referenceCpu(item);
    const slowest = Math.max(0, ...times);
    const total = times.reduce((sum, ms) => sum + ms, 0);
    assert.ok(slowest < TEST_LIMIT_MS / 3, `${item.case_id}: slowest test ${slowest.toFixed(0)} ms`);
    assert.ok(total < CASE_REFERENCE_LIMIT_MS, `${item.case_id}: the reference needs ${total.toFixed(0)} ms for the whole case`);
    console.log(`# ${item.case_id}: reference CPU max ${slowest.toFixed(0)} ms per test, ${total.toFixed(0)} ms per case`);
  }
});

test('most tests of an efficiency case are huge, and the first three are small', () => {
  for (const item of efficiency) {
    const labels = item.metadata.test_edges;
    const huge = labels.filter((label) => label.startsWith('huge')).length;
    assert.ok(huge / labels.length >= 0.65, `${item.case_id}: only ${huge} of ${labels.length} tests are huge`);
    assert.ok(labels.slice(0, 3).every((label) => !label.startsWith('huge')), `${item.case_id}: the first three tests must be small`);
    assert.ok(huge * TEST_LIMIT_MS <= PROCESS_LIMIT_MS * EFFICIENCY_BUDGET_FRACTION, `${item.case_id}: ${huge} huge tests cost a slow answer more than ${EFFICIENCY_BUDGET_FRACTION} of the process limit`);
  }
});

test('a naive solution passes every small test, fails every huge test, and scores at most 0.35', { timeout: 900000 }, async () => {
  const jobs = efficiency.map((item) => async () => ({ item, score: await scoreInChild(item, solutionText(item.case_id, '.naive')) }));
  for (const { item, score } of await pool(jobs, 3)) {
    const labels = item.metadata.test_edges;
    assert.equal(score.details.error, undefined, `${item.case_id}: the sandbox process failed: ${score.details.error}`);
    labels.forEach((label, index) => {
      const ok = score.details.results[index].ok;
      if (label.startsWith('huge')) assert.ok(!ok, `${item.case_id}: the naive solution passed huge test #${index}`);
      else assert.ok(ok, `${item.case_id}: the naive solution must agree with the reference on small test #${index}: ${failing(score).join(' | ')}`);
    });
    assert.ok(score.value <= NAIVE_SCORE_LIMIT, `${item.case_id}: naive score ${score.value}`);
    console.log(`# ${item.case_id}: naive score ${score.value}`);
  }
});

test('proof (LADDER_NAIVE_PROOF=1): a naive solution needs at least 20 s of CPU on the smallest huge test', { skip: !process.env.LADDER_NAIVE_PROOF, timeout: 1800000 }, async () => {
  // One job per huge test; at most 3 run side by side. The cheapest huge test of a case decides the margin.
  const jobs = efficiency.flatMap((item) => item.expected.tests
    .filter((_, index) => item.metadata.test_edges[index].startsWith('huge'))
    .map((one) => async () => ({ item, cpu: await naiveCpuInChild(solutionText(item.case_id, '.naive'), item.input.name, one.args) })));
  const least = new Map();
  for (const { item, cpu } of await pool(jobs, 3)) least.set(item.case_id, Math.min(least.get(item.case_id) ?? Infinity, cpu));
  for (const [caseId, ms] of least) {
    console.log(`# ${caseId}: naive CPU on the cheapest huge test ${(ms / 1000).toFixed(1)} s${ms >= NAIVE_PROOF_WALL_MS * 0.9 ? ' (stopped at the wall limit)' : ''}`);
    assert.ok(ms >= NAIVE_CPU_PROOF_MS, `${caseId}: the naive solution needs only ${(ms / 1000).toFixed(1)} s of CPU`);
  }
});

test('a plausible wrong solution scores above 0 and at most 0.5, for every case', { timeout: 600000 }, async () => {
  const jobs = cases.map((item) => async () => ({ item, score: await scoreInChild(item, solutionText(item.case_id, '.wrong')) }));
  for (const { item, score } of await pool(jobs, 3)) {
    assert.ok(score.value <= WRONG_SCORE_LIMIT, `${item.case_id}: the wrong solution scores ${score.value}, expected at most ${WRONG_SCORE_LIMIT}`);
    assert.ok(score.details.passed_tests > 0, `${item.case_id}: the wrong solution should be plausible, but it fails every test`);
    console.log(`# ${item.case_id}: wrong solution scores ${score.value}`);
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

test('every case has hand-derived tests: a spec case at least 8 over 5 rules, an efficiency case at least 3 small ones', () => {
  for (const item of cases) {
    const def = defs.get(item.case_id);
    assert.ok(def, `${item.case_id}: definition not found`);
    const handTests = def.tests.filter((one) => 'returns' in one);
    if (item.tags.includes('spec')) {
      assert.ok(handTests.length >= 8, `${item.case_id}: only ${handTests.length} hand-derived tests`);
      const rules = new Set(handTests.map((one) => one.edge));
      assert.ok(rules.size >= 5, `${item.case_id}: the hand-derived tests cover only ${rules.size} rules`);
    } else {
      const small = handTests.filter((one) => !one.edge.startsWith('huge'));
      assert.ok(small.length >= 3, `${item.case_id}: only ${small.length} small hand-derived tests`);
      assert.ok(handTests.every((one) => !one.edge.startsWith('huge')), `${item.case_id}: a huge test needs the reference`);
    }
    // The stored value of a hand-derived test is the one in the definition.
    handTests.forEach((one) => {
      const stored = item.expected.tests.find((entry) => JSON.stringify(entry.args) === JSON.stringify(one.args));
      assert.deepEqual(stored?.returns, one.returns, `${item.case_id}: stored value differs from the hand-derived one for ${JSON.stringify(one.args).slice(0, 80)}`);
    });
  }
});

// Each reference agrees with its hand-derived tests: generate.mjs keeps them as written, so compute the reference answer here.
test('every reference agrees with every hand-derived test of its definition', () => {
  for (const item of cases) {
    const def = defs.get(item.case_id);
    const context = vm.createContext({});
    vm.runInContext(solutionText(item.case_id), context);
    for (const one of def.tests.filter((entry) => 'returns' in entry)) {
      const got = JSON.parse(vm.runInContext(`JSON.stringify(${item.input.name}(...${JSON.stringify(one.args)}))`, context));
      assert.deepEqual(got, one.returns, `${item.case_id}: the reference disagrees with the hand-derived value for ${JSON.stringify(one.args).slice(0, 120)}`);
    }
  }
});
