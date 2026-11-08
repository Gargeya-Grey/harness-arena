// The reasoning-hard suite proves itself without a model call: the generator is
// stable and matches cases.jsonl, every case has exactly one answer when solved
// again from its stored instance (by the exhaustive solver, and by an independent
// method where one exists), the real final-answer evaluator accepts that answer and
// rejects near misses, and the text of every case states its answer format.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getEvaluator } from '../lab/evaluators/index.mjs';
import { readJsonl } from '../lab/lib/fsutil.mjs';
import { FAMILIES, RENDER, lines as generatedLines } from '../datasets/archive/reasoning-hard/generate.mjs';
import {
  fastLattice,
  fastMst,
  fastRoute,
  knightAssignments,
  logicGridSolutions,
  observedHolidays,
  ruleHolds,
  scheduleOrders,
  scheduleSearch,
  solveCase,
  holdsClue,
  statementTruth,
  toIso,
} from '../datasets/archive/reasoning-hard/solvers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(HERE, '..', 'datasets', 'archive', 'reasoning-hard');
const finalAnswer = getEvaluator('final-answer', '1');
const rows = readJsonl(path.join(SUITE, 'cases.jsonl')).rows;
const reply = (text) => ({ response: { text } });
const score = (testCase, text) => finalAnswer.score({ raw: reply(text), testCase }).value;

// ---- 1. the generator ----------------------------------------------------------

test('the generator is deterministic and its output is cases.jsonl, byte for byte', () => {
  const run = spawnSync(process.execPath, [path.join(SUITE, 'generate.mjs')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(!run.stdout.includes('\r'), 'LF only');
  const file = fs.readFileSync(path.join(SUITE, 'cases.jsonl'), 'utf8');
  assert.equal(run.stdout, file, 'cases.jsonl must equal the output of generate.mjs');
  assert.equal(generatedLines().join('\n') + '\n', file, 'an in-process run must print the same lines');
  assert.ok(file.endsWith('\n') && !file.endsWith('\n\n'));
});

test('the suite has 30 cases in at least 6 families of about 5 cases', () => {
  assert.equal(rows.length, 30);
  const byFamily = new Map();
  for (const item of rows) byFamily.set(item.metadata.family, (byFamily.get(item.metadata.family) || 0) + 1);
  assert.ok(byFamily.size >= 6, `families: ${[...byFamily.keys()]}`);
  for (const [family, count] of byFamily) assert.ok(count >= 3 && count <= 6, `${family} has ${count} cases`);
  assert.deepEqual([...byFamily.keys()].sort(), Object.keys(FAMILIES).sort());
  for (const [family, { count }] of Object.entries(FAMILIES)) assert.equal(byFamily.get(family), count);
});

// ---- 2. the solvers ------------------------------------------------------------

test('every case has exactly one answer, and it is the expected one', () => {
  for (const item of rows) {
    const solved = solveCase(item);
    assert.deepEqual(solved.answers, [item.expected], `${item.case_id}: answers ${JSON.stringify(solved.answers)}`);
    if ('solutions' in solved) assert.equal(solved.solutions, 1, `${item.case_id}: ${solved.solutions} configurations fit the clues`);
  }
});

test('an independent method gives the same answer (Kruskal, subset DP, grid DP, both scheduling searches)', () => {
  let checked = 0;
  for (const item of rows) {
    const { instance } = item.metadata;
    if (instance.kind === 'mst') {
      assert.equal(fastMst(instance), item.expected, item.case_id);
      checked += 1;
    } else if (instance.kind === 'route') {
      assert.equal(fastRoute(instance), item.expected, item.case_id);
      checked += 1;
    } else if (instance.kind === 'lattice') {
      assert.equal(fastLattice(instance), item.expected, item.case_id);
      checked += 1;
    } else if (item.metadata.family === 'schedule') {
      assert.equal(scheduleSearch(instance), item.expected, item.case_id);
      assert.equal(scheduleOrders(instance), item.expected, item.case_id);
      checked += 1;
    } else if (item.metadata.family === 'congruence') {
      // Closed form for the first two kinds: the solutions are one residue class mod the lcm.
      const mods = instance.congruences.map((c) => c.mod);
      const lcm = mods.reduce((a, b) => (a / gcd(a, b)) * b, 1);
      if (instance.kind === 'smallest') assert.ok(item.expected <= lcm, `${item.case_id}: smallest answer is below the lcm`);
      if (instance.kind === 'nth') assert.equal((item.expected - instance.congruences[0].rem) % instance.congruences[0].mod, 0);
      checked += 1;
    } else if (item.metadata.family === 'calendar') {
      assert.equal(calendarByMonths(instance), item.expected, item.case_id);
      checked += 1;
    }
  }
  assert.ok(checked >= 19, `only ${checked} cases were cross-checked`);
});

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

// Another way to compute the calendar answer: list all days, then group them by month.
function calendarByMonths(instance) {
  const DAY = 86400000;
  const t0 = Date.UTC(+instance.from.slice(0, 4), +instance.from.slice(5, 7) - 1, +instance.from.slice(8, 10));
  const days = [];
  for (let i = 0; i < 900; i += 1) days.push(new Date(t0 + i * DAY));
  const off = new Set(observedHolidays(instance.holidays));
  const [s1, s2] = instance.shutdown || ['9999-01-01', '9999-01-01'];
  const base = days.filter((d) => {
    const iso = d.toISOString().slice(0, 10);
    return d.getUTCDay() % 6 !== 0 && !off.has(iso) && !(iso >= s1 && iso <= s2);
  });
  const lastOfMonth = new Map();
  for (const d of base) lastOfMonth.set(d.toISOString().slice(0, 7), d.toISOString().slice(0, 10));
  const inventory = new Set(instance.inventory ? lastOfMonth.values() : []);
  const working = base.map((d) => d.toISOString().slice(0, 10)).filter((iso) => !inventory.has(iso));
  if (instance.kind === 'finish') return working[instance.need - 1];
  return working.filter((iso) => iso <= instance.to).length;
}

test('wording and solver agree on the rules that are easy to misread', () => {
  // Logic grid: "directly to the left" is the next lower seat; "exactly one seat between" is a distance of 2.
  const seat = [[0, 1, 2, 3, 4], [2, 3, 4, 0, 1]];
  assert.ok(holdsClue({ type: 'left', a: [0, 0], b: [0, 1] }, seat));
  assert.ok(!holdsClue({ type: 'left', a: [0, 1], b: [0, 0] }, seat));
  assert.ok(holdsClue({ type: 'gap', a: [0, 0], b: [0, 2] }, seat));
  assert.ok(!holdsClue({ type: 'gap', a: [0, 0], b: [0, 1] }, seat));
  assert.ok(holdsClue({ type: 'between', a: [0, 2], b: [0, 4], c: [0, 0] }, seat));
  assert.ok(!holdsClue({ type: 'between', a: [0, 2], b: [0, 3], c: [0, 4] }, seat));
  // Knights and knaves: a knave's statement must be false; "at most" includes the bound.
  assert.equal(statementTruth({ type: 'count', set: [0, 1, 2], kind: 'knave', op: 'atmost', k: 1 }, [true, true, false]), true);
  assert.equal(statementTruth({ type: 'count', set: [0, 1, 2], kind: 'knave', op: 'atmost', k: 1 }, [true, false, false]), false);
  assert.deepEqual(knightAssignments({ people: ['a'], statements: [{ type: 'is', x: 0, kind: 'knave' }] }), [], 'a lone "I am a knave" has no solution');
  // Seating: "at least two seats between" means a distance of 3 or more; seats are numbered from 1.
  assert.ok(ruleHolds({ t: 'apart', x: 0, y: 1 }, [0, 3], 8));
  assert.ok(!ruleHolds({ t: 'apart', x: 0, y: 1 }, [0, 2], 8));
  assert.ok(ruleHolds({ t: 'seat', x: 0, seats: [1, 8] }, [0], 8));
  assert.ok(!ruleHolds({ t: 'notEnd', x: 0 }, [7], 8));
  // Calendar: a Saturday holiday is taken on the Friday, a Sunday holiday on the Monday.
  assert.deepEqual(observedHolidays(['2027-01-02', '2027-01-03', '2027-01-04']), ['2027-01-01', '2027-01-04', '2027-01-04']);
  assert.equal(toIso(Date.UTC(2028, 1, 29)), '2028-02-29');
});

test('the logic grids are minimal and the scheduling cases are not settled by a simple bound', () => {
  for (const item of rows.filter((r) => r.metadata.family === 'logic-grid')) {
    const { instance } = item.metadata;
    assert.ok(instance.clues.length >= 8 && instance.clues.length <= 12, `${item.case_id}: ${instance.clues.length} clues`);
    for (let drop = 0; drop < instance.clues.length; drop += 1) {
      const rest = { ...instance, clues: instance.clues.filter((_, i) => i !== drop) };
      assert.ok(logicGridSolutions(rest, 2).length > 1, `${item.case_id}: clue ${drop + 1} is redundant`);
    }
  }
  for (const item of rows.filter((r) => r.metadata.family === 'schedule')) {
    const { tasks } = item.metadata.instance;
    const total = tasks.reduce((s, t) => s + t.hours, 0);
    assert.ok(item.expected > Math.ceil(total / 2), `${item.case_id}: the load bound already gives the answer`);
    assert.ok(tasks.length >= 8);
  }
});

// ---- 3. the real evaluator -----------------------------------------------------

function nearMisses(expected) {
  if (typeof expected === 'number') return [expected + 1, expected - 1];
  if (/^\d{4}-\d{2}-\d{2}$/.test(expected)) {
    const t = Date.UTC(+expected.slice(0, 4), +expected.slice(5, 7) - 1, +expected.slice(8, 10));
    return [toIso(t + 86400000), toIso(t - 86400000)];
  }
  const chars = expected.split('');
  const out = [];
  for (let i = 0; i + 1 < chars.length; i += 1) {
    if (chars[i] === chars[i + 1]) continue;
    const swapped = chars.slice();
    [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
    out.push(swapped.join(''));
  }
  out.push(`${expected}x`);
  return out;
}

test('every expected answer scores 1 through final-answer@1, and near misses score 0', () => {
  for (const item of rows) {
    assert.ok(typeof item.expected === 'number' ? Number.isInteger(item.expected) : /^[A-Za-z]+$|^\d{4}-\d{2}-\d{2}$/.test(item.expected), `${item.case_id}: unusual answer form ${item.expected}`);
    assert.equal(score(item, `Working it out.\nAnswer: ${item.expected}`), 1, `${item.case_id}: the expected answer must score 1`);
    assert.equal(score(item, `**Answer:** ${item.expected}.`), 1, `${item.case_id}: bold marker and final stop`);
    if (typeof item.expected === 'string') {
      assert.equal(score(item, `Answer: ${item.expected.toLowerCase()}`), 1, `${item.case_id}: case does not matter`);
      assert.equal(score(item, `Answer: ${item.expected.toUpperCase()}`), 1, `${item.case_id}: case does not matter`);
    }
    const misses = nearMisses(item.expected).filter((miss) => String(miss).toLowerCase() !== String(item.expected).toLowerCase());
    assert.ok(misses.length > 0, `${item.case_id}: no near miss to test`);
    for (const miss of misses) assert.equal(score(item, `Answer: ${miss}`), 0, `${item.case_id}: "${miss}" must score 0`);
    assert.equal(score(item, ''), 0, `${item.case_id}: an empty reply must score 0`);
  }
});

// ---- 4. ids and text -----------------------------------------------------------

test('case ids are unique and match the pattern; tags, input and schema fields are right', () => {
  const ids = rows.map((item) => item.case_id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of rows) {
    assert.match(item.case_id, /^reasoning-hard-[a-z]+(?:-[a-z]+)*-\d+$/);
    assert.deepEqual(item.tags, [item.metadata.family, 'hard']);
    assert.deepEqual(Object.keys(item.input), ['question'], 'the prompt takes only {{question}}');
    assert.ok(item.case_id.startsWith(`reasoning-hard-${item.metadata.family}-`));
    assert.deepEqual(Object.keys(item).sort(), ['case_id', 'expected', 'input', 'metadata', 'tags']);
    assert.equal(RENDER[item.metadata.family](item.metadata.instance), item.input.question, `${item.case_id}: text must be rebuilt from the stored instance`);
  }
});

test('the text of every case states the answer format, last', () => {
  for (const item of rows) {
    const textLines = item.input.question.trimEnd().split('\n');
    const last = textLines.at(-1);
    assert.match(last, /^Answer format: /, `${item.case_id}: last line must give the answer format`);
    if (typeof item.expected === 'number') assert.match(last, /whole number/, item.case_id);
    else if (/^\d{4}-/.test(item.expected)) assert.match(last, /YYYY-MM-DD/, item.case_id);
    else if (/^[KN]+$/.test(item.expected) && item.metadata.family === 'knights') assert.match(last, new RegExp(`${item.expected.length} capital letters`), item.case_id);
    else assert.match(last, /one (?:word|first name)|first name|word/, item.case_id);
  }
});

test('no two cases share the same text, and none shares an instance', () => {
  const texts = rows.map((item) => item.input.question);
  assert.equal(new Set(texts).size, texts.length);
  const instances = rows.map((item) => JSON.stringify(item.metadata.instance));
  assert.equal(new Set(instances).size, instances.length);
  // Within a family the cases differ in their answer too, so a model cannot repeat one reply.
  for (const family of Object.keys(FAMILIES)) {
    const answers = rows.filter((item) => item.metadata.family === family).map((item) => item.expected);
    assert.ok(new Set(answers).size >= Math.ceil(answers.length * 0.6), `${family}: too many equal answers ${answers}`);
  }
});
