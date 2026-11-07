// The supreme tier of the ladder-code suite (tier 5) proves itself without a model call.
//
// - Every reference solution passes its hidden tests through the real js-function@2
//   evaluator, and the efficiency cases stay far inside the sandbox time limits.
// - Every efficiency case is mostly huge tests, so a naive solution that agrees with
//   the reference on small inputs but times out on the huge ones scores at most 0.35.
//   The reference needs under 12 s for the whole case.
// - Every case has a plausible but wrong solution that scores below 1; an empty
//   function scores 0.
// - The task text names every edge case a test checks, and each case is small.
//
// The solutions live in tests/fixtures/ladder-code-solutions/supreme/:
//   <case_id>.mjs         reference
//   <case_id>.naive.mjs   correct on small inputs, too slow on huge ones (efficiency cases; parse-counter holds an enumerator)
//   <case_id>.wrong.mjs   plausible mistake
//
// Time budget: a naive or brute-force answer times out on some tests, and each one costs 2 s of the
// 30 s the sandbox process gets. Every case, spec cases included, keeps those tests inside a share of the
// process limit (BUDGET_FRACTION), so a slow answer scores the same on an idle and on a busy machine.
//
// The reference solution is not the only judge of the expected values. Every case also carries
// hand-derived tests: tests whose `returns` stands in the definition (worked out from the task text,
// not computed by the reference). The reference has to agree with all of them.

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
const DEFS = path.join(HERE, '..', 'datasets', 'ladder-code', 'defs', 'supreme');
const SOLUTIONS = path.join(HERE, 'fixtures', 'ladder-code-solutions', 'supreme');
const EVALUATOR_URL = pathToFileURL(path.join(HERE, '..', 'lab', 'evaluators', 'index.mjs')).href;

// js-function@2 (lab/evaluators) gives each test 2 s of CPU time and all tests of a case 30 s of CPU time.
const TEST_LIMIT_MS = 2000;
const PROCESS_LIMIT_MS = 30000;
// The reference solutions of one case together, and the best score a correct but slow solution may reach.
const CASE_REFERENCE_LIMIT_MS = 12000;
const NAIVE_SCORE_LIMIT = 0.35;
// A case may hold tests that cost a slow answer the full 2 s each. A spec case keeps them within half of the
// process limit (7 tests). An efficiency case keeps its old limit of three quarters (11 tests): its huge
// tests are the point of the case, and every efficiency case holds 10 of them (a slow answer loses them by design).
const BUDGET_FRACTION = { spec: 0.5, efficiency: 0.75 };
// Enumeration speed: an enumerator visits about 1.5e7 steps per second in the sandbox (measured on the
// parse-counter enumerator). A test that needs more than ENUMERATION_STEPS is counted as unfinished. The
// layout rule uses the number of layouts the same way, with a margin: above 3e7 no enumeration finishes in 2 s.
const ENUMERATION_STEPS = 1e7;
const LAYOUT_LIMIT = 3e7;

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

// How many tests of a case a naive or brute-force answer cannot finish, by a rule that does not depend on
// the speed of the machine (a count of labels, steps or layouts, never a clock).
//
// - efficiency case: the tests labelled huge (the naive fixture is run for real by another test).
// - parse-counter: the enumerator fixture counts its steps; a test that needs more than ENUMERATION_STEPS
//   is unfinished. It stops at the limit, so a test with 2^58 derivations costs about 0.7 s here, not hours.
// - balanced-layout: the number of ways to cut the items of the text into lines that fit. An answer that
//   tries every layout (or a recursion without a memo) has to visit them all; above LAYOUT_LIMIT it cannot.
// - lumen-interpreter, sheet-engine: no search space; the expected value follows from one pass over the input.
const NOTHING_TO_ENUMERATE = new Set(['ladder-code-lumen-interpreter', 'ladder-code-sheet-engine']);

function enumeratorSteps(item) {
  const source = solutionText(item.case_id, '.naive');
  return item.expected.tests.map((one, index) => {
    const context = vm.createContext({ __STEP_LIMIT: ENUMERATION_STEPS });
    vm.runInContext(source, context);
    try {
      const value = vm.runInContext(`${item.input.name}(...${JSON.stringify(one.args)})`, context);
      assert.equal(value, one.returns, `${item.case_id}: the enumerator disagrees with the stored value of test #${index}`);
      return false;
    } catch (error) {
      if (error?.message === 'step limit') return true;
      throw error;
    }
  });
}

// The items of a text as the task text defines them, and the number of ways to put them into lines of at most width.
function layoutCount(text, width) {
  const alnum = (c) => /[A-Za-z0-9]/.test(c ?? '');
  const items = [];
  text.split(' ').filter(Boolean).forEach((word, wordIndex) => {
    const fragments = [];
    let current = '';
    for (let i = 0; i < word.length; i += 1) {
      current += word[i];
      if (word[i] === '-' && alnum(word[i - 1]) && alnum(word[i + 1])) {
        fragments.push(current);
        current = '';
      }
    }
    if (current) fragments.push(current);
    for (const fragment of fragments) for (let at = 0; at < fragment.length; at += width) items.push({ length: Math.min(width, fragment.length - at), word: wordIndex });
  });
  const ways = new Array(items.length + 1).fill(0);
  ways[items.length] = 1;
  for (let from = items.length - 1; from >= 0; from -= 1) {
    let length = 0;
    for (let to = from; to < items.length; to += 1) {
      length += items[to].length + (to > from && items[to].word !== items[to - 1].word ? 1 : 0);
      if (length > width) break;
      ways[from] += ways[to + 1];
    }
  }
  return ways[0];
}

function unfinishedTests(item) {
  if (item.tags.includes('efficiency')) return item.metadata.test_edges.filter((label) => label.startsWith('huge')).length;
  if (item.case_id === 'ladder-code-parse-counter') return enumeratorSteps(item).filter(Boolean).length;
  if (item.case_id === 'ladder-code-balanced-layout') return item.expected.tests.filter((one) => layoutCount(one.args[0], one.args[1]) > LAYOUT_LIMIT).length;
  assert.ok(NOTHING_TO_ENUMERATE.has(item.case_id), `${item.case_id}: state how a naive answer is counted`);
  return 0;
}

const failing = (score) => score.details.results.map((item, index) => ({ index, item })).filter(({ item }) => !item.ok).map(({ index, item }) => `#${index} ${JSON.stringify(item).slice(0, 300)}`);

test('the supreme tier holds 10 tier 5 cases: 6 efficiency, 4 precise-spec, all with unique ids', () => {
  assert.equal(slugs.length, 10, 'one definition file per case');
  assert.equal(cases.length, 10);
  assert.equal(new Set(cases.map((item) => item.case_id)).size, 10, 'duplicate case_id');
  assert.equal(efficiency.length, 6);
  assert.equal(specs.length, 4);
  for (const item of cases) {
    assert.match(item.case_id, /^ladder-code-[a-z0-9-]+$/);
    assert.equal(item.metadata.tier.level, 5, `${item.case_id}: tier 5`);
    assert.equal(item.metadata.tier.name, 'supreme');
    assert.equal(item.tags[0], 'tier-5-supreme');
    const minutes = item.metadata.tier.human_minutes;
    assert.ok(minutes > 120 && minutes <= 960, `${item.case_id}: ${minutes} min is outside 120..960`);
    assert.ok(item.metadata.tier.basis.length >= 40, `${item.case_id}: the basis should say how the time was estimated`);
    assert.deepEqual(Object.keys(item.input).sort(), ['name', 'signature', 'task'], `${item.case_id}: input holds the prompt variables`);
    assert.ok(item.input.signature.startsWith(`${item.input.name}(`), `${item.case_id}: signature starts with the function name`);
    assert.ok(item.input.task.length > 400, `${item.case_id}: the task text is complete`);
    assert.equal(item.tags.length, 2, `${item.case_id}: tags are [tier, kind]`);
    const count = item.expected.tests.length;
    // The spec cases hold a large set of hand-derived tests next to the computed ones.
    assert.ok(count >= 8 && count <= 250, `${item.case_id}: ${count} tests, expected 8 to 250`);
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
    // CPU time, not wall time: the verdict must not depend on how busy the machine is.
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
  }
});

test('most tests of an efficiency case are huge, and the first three are small', () => {
  for (const item of efficiency) {
    const labels = item.metadata.test_edges;
    const huge = labels.filter((label) => label.startsWith('huge')).length;
    assert.ok(huge / labels.length >= 0.65, `${item.case_id}: only ${huge} of ${labels.length} tests are huge`);
    assert.ok(labels.slice(0, 3).every((label) => !label.startsWith('huge')), `${item.case_id}: the first three tests must be small`);
  }
});

test('a naive or brute-force answer times out on tests worth only part of the 30 s process limit, in every case', () => {
  for (const item of cases) {
    const unfinished = unfinishedTests(item);
    // The sandbox stops a process after 30 s, and a timed-out test costs 2 s: leave room for the rest of the work.
    const share = BUDGET_FRACTION[item.tags.includes('efficiency') ? 'efficiency' : 'spec'];
    assert.ok(unfinished * TEST_LIMIT_MS <= PROCESS_LIMIT_MS * share, `${item.case_id}: ${unfinished} tests a slow answer cannot finish, ${unfinished * TEST_LIMIT_MS / 1000} s of ${PROCESS_LIMIT_MS / 1000} s (limit ${share})`);
    console.log(`# ${item.case_id}: ${unfinished} unfinished tests, ${unfinished * TEST_LIMIT_MS / 1000} s of timeouts`);
  }
});

test('the parse-counter enumerator is correct on every test it can finish, and it cannot finish the six huge ones', () => {
  const item = cases.find((one) => one.case_id === 'ladder-code-parse-counter');
  const unfinished = enumeratorSteps(item);
  assert.equal(unfinished.filter(Boolean).length, 6);
  assert.ok(unfinished.filter((flag) => !flag).length > 100, 'the enumerator should finish the ordinary tests');
});

// Every layout of a text without hyphens, as lists of line ends, with its cost (the last line is free).
function layouts(text, width) {
  const words = text.split(' ').filter(Boolean);
  const found = [];
  const walk = (from, ends, cost) => {
    if (from === words.length) {
      found.push({ ends, cost });
      return;
    }
    let length = 0;
    for (let to = from; to < words.length; to += 1) {
      length += words[to].length + (to > from ? 1 : 0);
      if (length > width) break;
      walk(to + 1, [...ends, to + 1], cost + (to + 1 === words.length ? 0 : (width - length) ** 2));
    }
  };
  walk(0, [], 0);
  return found;
}

test('every tie-later row of balanced-layout has two optimal layouts, and the stored answer is the one with the latest breaks', () => {
  const def = defs.get('ladder-code-balanced-layout');
  const rows = def.tests.filter((one) => one.edge === 'tie-later' && 'returns' in one);
  assert.ok(rows.length >= 4);
  for (const row of rows) {
    const [text, width] = row.args;
    assert.ok(!text.includes('-'), 'the oracle does not split hyphens');
    const all = layouts(text, width);
    const best = Math.min(...all.map((one) => one.cost));
    const optimal = all.filter((one) => one.cost === best);
    assert.ok(optimal.length >= 2, `${JSON.stringify(row.args)}: only ${optimal.length} optimal layout`);
    // The later break wins: compare the line ends from the first line on, the larger end is better.
    const winner = optimal.reduce((a, b) => (a.ends.some((end, i) => end !== b.ends[i] && end < b.ends[i] && a.ends.slice(0, i).every((e, j) => e === b.ends[j])) ? b : a));
    const words = text.split(' ');
    const lines = winner.ends.map((end, i) => words.slice(i === 0 ? 0 : winner.ends[i - 1], end).join(' '));
    assert.deepEqual(row.returns.map((line) => line.split(/ +/).join(' ')), lines, `${JSON.stringify(row.args)}`);
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

test('a plausible wrong solution scores below 1, and above 0, for every case', { timeout: 600000 }, async () => {
  const jobs = cases.map((item) => async () => ({ item, score: await scoreInChild(item, solutionText(item.case_id, '.wrong')) }));
  for (const { item, score } of await pool(jobs, 3)) {
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

test('every case has hand-derived tests: a spec case at least 10 and every rule family, an efficiency case at least 3 small ones', () => {
  for (const item of cases) {
    const def = defs.get(item.case_id);
    assert.ok(def, `${item.case_id}: definition not found`);
    const handTests = def.tests.filter((one) => 'returns' in one);
    if (item.tags.includes('spec')) {
      assert.ok(handTests.length >= 10, `${item.case_id}: only ${handTests.length} hand-derived tests`);
      // Each rule family that the definition names is covered by a hand-derived test, not only by a computed one.
      for (const name of Object.keys(def.edges)) {
        assert.ok(handTests.some((one) => one.edge === name), `${item.case_id}: no hand-derived test for the edge "${name}"`);
      }
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
