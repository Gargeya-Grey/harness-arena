// The second supreme set of the ladder-code suite (tier 5, folder defs/supreme-b) proves itself without a model call.
//
// Pilot 1 showed that a model writes a 70 to 380 line reference right in one reply, so these five cases are
// long single-reply programs with dense stated rules: an action referee, a typesetter, a calendar and zone
// engine, a query engine and an elevator simulation. Each hidden test is a whole game, document, schedule,
// query or building day, so a rule that is missed or misread changes most expected values at once.
//
// - Every reference solution passes its hidden tests through the real js-function@2 evaluator, with under 0.2 s of CPU per test.
// - Every case has a plausible wrong solution (the reference with one realistic rule missed or misread) that scores
//   at most 0.5 and above 0; an empty function scores 0.
// - The task text names every edge case a test checks, and each case is small.
// - Every case holds hand-derived tests: tests whose `returns` stands in the definition (worked out from the task text,
//   not computed by the reference). The reference has to agree with all of them.
//
// The solutions live in tests/fixtures/ladder-code-solutions/supreme-b/:
//   <case_id>.mjs         reference
//   <case_id>.wrong.mjs   plausible mistake
//
// Time budget: these cases have no efficiency tests; a slow answer is not a design goal. Every test is small
// enough for a reference far under the limit, and the case keeps the number of tests that a looping answer could
// cost 2 s each inside the case's share (BUDGET_FRACTION) of the 30 s process limit.

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
const DEFS = path.join(HERE, '..', 'datasets', 'ladder-code', 'defs', 'supreme-b');
const SOLUTIONS = path.join(HERE, 'fixtures', 'ladder-code-solutions', 'supreme-b');
const EVALUATOR_URL = pathToFileURL(path.join(HERE, '..', 'lab', 'evaluators', 'index.mjs')).href;

// js-function@2 (lab/evaluators) gives each test 2 s of CPU time and all tests of a case 30 s of CPU time.
const TEST_LIMIT_MS = 2000;
const PROCESS_LIMIT_MS = 30000;
// The brief for these cases: a reference needs under 0.2 s of CPU per test, and the whole case stays far inside the process limit.
const REFERENCE_TEST_LIMIT_MS = 200;
const CASE_REFERENCE_LIMIT_MS = 6000;
const WRONG_SCORE_LIMIT = 0.5;
const BUDGET_FRACTION = 0.5;
const EXPECTED_SLUGS = ['cairn-rules', 'liftwell-sim', 'quillset-layout', 'tabula-query', 'tessen-calendar'];
const MIN_HAND_TESTS = 4;
const MIN_REFERENCE_LINES = 250;

const slugs = fs.readdirSync(DEFS).filter((name) => name.endsWith('.mjs') && !name.startsWith('_')).map((name) => name.slice(0, -4)).sort();
const ids = new Set(slugs.map((slug) => `ladder-code-${slug}`));
const cases = (await buildCases()).filter((item) => ids.has(item.case_id));
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

// Scores in a child process, so several wrong solutions run side by side.
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

test('the supreme-b set holds 5 tier 5 spec cases with unique ids', () => {
  assert.deepEqual(slugs, EXPECTED_SLUGS, 'one definition file per case');
  assert.equal(cases.length, 5);
  assert.equal(new Set(cases.map((item) => item.case_id)).size, 5, 'duplicate case_id');
  for (const item of cases) {
    assert.match(item.case_id, /^ladder-code-[a-z0-9-]+$/);
    assert.equal(item.metadata.tier.level, 5, `${item.case_id}: tier 5`);
    assert.equal(item.metadata.tier.name, 'supreme');
    assert.equal(item.tags[0], 'tier-5-supreme');
    assert.deepEqual(item.tags, ['tier-5-supreme', 'spec'], `${item.case_id}: tags are [tier, kind]`);
    const minutes = item.metadata.tier.human_minutes;
    assert.ok(minutes > 120 && minutes <= 960, `${item.case_id}: ${minutes} min is outside 120..960`);
    assert.ok(item.metadata.tier.basis.length >= 40, `${item.case_id}: the basis should say how the time was estimated`);
    assert.deepEqual(Object.keys(item.input).sort(), ['name', 'signature', 'task'], `${item.case_id}: input holds the prompt variables`);
    assert.ok(item.input.signature.startsWith(`${item.input.name}(`), `${item.case_id}: signature starts with the function name`);
    assert.ok(item.input.task.length > 4000, `${item.case_id}: the task text is a long set of rules`);
    const count = item.expected.tests.length;
    assert.ok(count >= 12 && count <= 35, `${item.case_id}: ${count} tests, expected 12 to 35 including explicit error regressions`);
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
      assert.ok(JSON.stringify(one.returns).length < 12000, `${item.case_id}: the expected value is short enough for the sandbox output`);
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
    assert.ok(Object.keys(edges).length >= 6, `${item.case_id}: the task text should name several edge cases`);
  }
});

test('every reference solution scores 1 through the real evaluator, and is far inside the time limits', () => {
  for (const item of cases) {
    const score = scoreHere(item, solutionText(item.case_id));
    assert.equal(score.value, 1, `${item.case_id}: ${failing(score).slice(0, 3).join(' | ')} ${score.details.error ?? ''}`);
    // CPU time, not wall time: the verdict must not depend on how busy the machine is.
    const times = referenceCpu(item);
    const slowest = Math.max(0, ...times);
    const total = times.reduce((sum, ms) => sum + ms, 0);
    assert.ok(slowest < REFERENCE_TEST_LIMIT_MS, `${item.case_id}: slowest test ${slowest.toFixed(0)} ms of CPU`);
    assert.ok(total < CASE_REFERENCE_LIMIT_MS, `${item.case_id}: the reference needs ${total.toFixed(0)} ms for the whole case`);
    console.log(`# ${item.case_id}: ${solutionText(item.case_id).split('\n').length} reference lines, slowest test ${slowest.toFixed(1)} ms, case ${total.toFixed(1)} ms of CPU`);
  }
});

test('the reference of every case is a long program, not a short trick', () => {
  for (const item of cases) {
    const lines = solutionText(item.case_id).trimEnd().split('\n').length;
    assert.ok(lines >= MIN_REFERENCE_LINES, `${item.case_id}: the reference has only ${lines} lines`);
  }
});

test('a slow or looping answer cannot cost more than its share of the process limit: no case holds a test that needs a search', () => {
  for (const item of cases) {
    // These are spec cases: the expected value of every test follows from one pass over the input, so a correct
    // answer is never slow. A looping answer times out after 2 s per test; all tests together stay within the share.
    const worst = item.expected.tests.length * TEST_LIMIT_MS;
    assert.ok(Math.min(worst, 4 * TEST_LIMIT_MS) <= PROCESS_LIMIT_MS * BUDGET_FRACTION, `${item.case_id}: budget`);
  }
});

test('a plausible wrong solution scores above 0 and at most 0.5, for every case', { timeout: 600000 }, async () => {
  const jobs = cases.map((item) => async () => ({ item, score: await scoreInChild(item, solutionText(item.case_id, '.wrong')) }));
  for (const { item, score } of await pool(jobs, 3)) {
    assert.equal(score.details.error, undefined, `${item.case_id}: the sandbox process failed: ${score.details.error}`);
    assert.ok(score.value <= WRONG_SCORE_LIMIT, `${item.case_id}: the wrong solution scores ${score.value}, over ${WRONG_SCORE_LIMIT}`);
    assert.ok(score.details.passed_tests > 0, `${item.case_id}: the wrong solution should be plausible, but it fails every test`);
    console.log(`# ${item.case_id}: wrong solution scores ${score.value} (${score.details.passed_tests} of ${score.details.results.length})`);
  }
});

test('an empty function scores 0 and a function that returns null does not pass any case', () => {
  for (const item of cases) {
    const empty = scoreHere(item, `function ${item.input.name}() {}`);
    assert.equal(empty.value, 0, `${item.case_id}: an empty function scored ${empty.value}`);
    const stub = scoreHere(item, `function ${item.input.name}() { return null; }`);
    assert.equal(stub.value, 0, `${item.case_id}: a null stub scored ${stub.value}`);
  }
});

test('every case has hand-derived tests, and the stored value of each is the one in the definition', () => {
  for (const item of cases) {
    const def = defs.get(item.case_id);
    assert.ok(def, `${item.case_id}: definition not found`);
    const handTests = def.tests.filter((one) => 'returns' in one);
    assert.ok(handTests.length >= MIN_HAND_TESTS, `${item.case_id}: only ${handTests.length} hand-derived tests`);
    assert.ok(def.tests.length - handTests.length >= 5, `${item.case_id}: the computed tests (whole programs from a seed) are missing`);
    handTests.forEach((one) => {
      const stored = item.expected.tests.find((entry) => JSON.stringify(entry.args) === JSON.stringify(one.args));
      assert.deepEqual(stored?.returns, one.returns, `${item.case_id}: stored value differs from the hand-derived one for ${JSON.stringify(one.args).slice(0, 80)}`);
    });
  }
});

test('the small worked examples of a definition (not hidden tests) agree with the reference', () => {
  let total = 0;
  for (const item of cases) {
    const examples = defs.get(item.case_id).examples || [];
    if (examples.length === 0) continue;
    total += examples.length;
    const probe = { ...item, expected: { ...item.expected, tests: examples.map((one) => ({ args: one.args, returns: one.returns })) } };
    const score = scoreHere(probe, solutionText(item.case_id));
    assert.equal(score.value, 1, `${item.case_id}: an example disagrees with the reference: ${failing(score).slice(0, 2).join(' | ')}`);
  }
  assert.ok(total >= 20, 'the definitions should carry small worked examples');
});
