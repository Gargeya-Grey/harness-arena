// Proof for the ladder-answer suite (datasets/ladder-answer/defs). It builds the cases
// in memory with buildCases() and checks that
//   - each tier holds its quota and every case fits the tier table,
//   - every new case (tiers 4 and 5) solves again from its stored instance to its
//     stored answer, by exact methods that agree, and is unique where the family claims it,
//   - the tempting shortcut of each new family misses the answer on most instances,
//   - every folded case equals its origin case in the old cases.jsonl, and the
//     folded hard cases solve again from their stored instance.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCases } from '../datasets/ladder-answer/generate.mjs';
import { FAMILIES } from '../datasets/ladder-answer/defs/_families.mjs';
import { SOLVERS as OLD_SOLVERS } from '../datasets/ladder-answer/defs/folded/_old-solvers.mjs';
import * as seqdp from '../datasets/ladder-answer/defs/_seqdp.mjs';
import { caseProblems, loadLadder } from '../lab/lib/ladder.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUOTA = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 8 };
// The suite's cases, and every case including the retired ones (defs/_retired.mjs): the quota and
// the tier table hold for the suite; the proofs run for every definition, retired or not.
const all = await buildCases({ includeRetired: true });
const cases = all.filter((item) => !item.metadata.tier.retired);
const level = (item) => item.metadata.tier.level;
const generated = all.filter((item) => level(item) >= 4);
const folded = all.filter((item) => item.metadata.tier.origin);

// ---- quota and tier table ------------------------------------------------------------------

test('each tier holds its quota of answer tasks', () => {
  const counts = {};
  for (const item of cases) counts[level(item)] = (counts[level(item)] || 0) + 1;
  assert.deepEqual(counts, QUOTA);
  assert.equal(cases.length, 24);
});

test('the quota matches the answer share of configs/ladder.yaml', () => {
  const ladder = loadLadder(ROOT);
  for (const tier of ladder.tiers) assert.equal(QUOTA[tier.level], tier.kinds.answer, `tier ${tier.level}`);
});

test('every case fits the tier table: tag, name, expert minutes in range, a basis', () => {
  const ladder = loadLadder(ROOT);
  const problems = cases.flatMap((item) => caseProblems(item, ladder));
  assert.deepEqual(problems, []);
  assert.equal(new Set(cases.map((item) => item.case_id)).size, cases.length);
  for (const item of cases) assert.match(item.case_id, /^ladder-answer-[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('every answer is one number, one word or an ISO date', () => {
  for (const item of cases) {
    const { expected } = item;
    if (typeof expected === 'number') assert.ok(Number.isFinite(expected), item.case_id);
    else assert.match(expected, /^([A-Za-z]+|\d{4}-\d{2}-\d{2})$/, item.case_id);
    assert.ok(typeof item.input.question === 'string' && item.input.question.length > 20, item.case_id);
    assert.ok(!item.input.question.includes('<<FILL IN>>'), item.case_id);
  }
});

test('the retired tasks are left out of the suite, each with a reason, and their slugs stay taken', async () => {
  const retired = all.filter((item) => item.metadata.tier.retired);
  assert.equal(retired.length, 16);
  const originalRetirements = retired.filter(item => item.metadata.tier.retired.startsWith('Pilot 1'));
  assert.equal(originalRetirements.length, 13);
  for (const item of originalRetirements) assert.match(item.metadata.tier.retired, /^Pilot 1 \(suite 1\.0\.0\): panel mean /, item.case_id);
  const reviewedRetirements = retired.filter(item => !originalRetirements.includes(item));
  assert.deepEqual(reviewedRetirements.map(item => item.case_id).sort(), ['ladder-answer-box-shipping-seventeen-parcels', 'ladder-answer-box-shipping-thirteen-parcels', 'ladder-answer-building-fourteen-tasks']);
  for (const item of reviewedRetirements) assert.match(item.metadata.tier.retired, /^Difficulty review \(suite 2\.0\.0\):.*no human timing was measured\.$/, item.case_id);
  assert.equal(all.length, cases.length + retired.length);
  const stored = new Set(fs.readFileSync(path.join(ROOT, 'datasets', 'ladder-answer', 'cases.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).case_id));
  for (const item of retired) assert.ok(!stored.has(item.case_id), `${item.case_id} is still in cases.jsonl`);
});

test('tier 5 uses at least three different families, tier 4 at least three', () => {
  const families = (n) => new Set(cases.filter((item) => level(item) === n).map((item) => item.metadata.family));
  assert.ok(families(5).size >= 3, [...families(5)].join(', '));
  assert.ok(families(4).size >= 3, [...families(4)].join(', '));
});

// ---- generated cases solve again from the stored instance -------------------------------------

test('every generated case re-solves from its metadata to the stored answer, and the question is its rendering', () => {
  assert.equal(generated.length, 30);
  for (const item of generated) {
    const family = FAMILIES[item.metadata.family];
    assert.ok(family, `${item.case_id}: unknown family ${item.metadata.family}`);
    const solved = family.solve(item.metadata.instance); // throws when the family's proofs fail
    assert.equal(solved.answer, item.expected, item.case_id);
    assert.equal(family.render(item.metadata.instance), item.input.question, item.case_id);
    assert.deepEqual(JSON.parse(JSON.stringify(item.metadata.instance)), item.metadata.instance, item.case_id);
  }
});

test('logic grids have exactly one seating and every clue is needed', async () => {
  const { gridSolutions } = await import('../datasets/ladder-answer/defs/_grid.mjs');
  const grids = generated.filter((item) => item.metadata.family === 'grid');
  assert.equal(grids.length, 4);
  for (const item of grids) {
    const instance = item.metadata.instance;
    assert.equal(gridSolutions(instance, 3).length, 1, `${item.case_id}: not unique`);
    instance.clues.forEach((_, drop) => {
      const rest = { ...instance, clues: instance.clues.filter((__, i) => i !== drop) };
      assert.ok(gridSolutions(rest, 2).length > 1, `${item.case_id}: clue ${drop + 1} is not needed`);
    });
  }
});

test('word counts: a full listing of the valid words agrees, and the table methods agree on short words', () => {
  const words = generated.filter((item) => item.metadata.family === 'seqdp');
  assert.equal(words.length, 2);
  for (const item of words) {
    const rules = item.metadata.instance;
    assert.equal(seqdp.countDfs(rules), item.expected, `${item.case_id}: listing`);
    for (const length of [5, 7]) {
      const short = seqdp.shorter(rules, length);
      const listed = seqdp.countBrute(short);
      assert.equal(seqdp.countForward(short), listed, `${item.case_id}: forward at length ${length}`);
      assert.equal(seqdp.countBackward(short), listed, `${item.case_id}: backward at length ${length}`);
    }
  }
});

// ---- the tempting shortcut misses ----------------------------------------------------------------

test('the stored shortcut answers are the ones the code gives, and none equals the answer', () => {
  for (const item of generated) {
    const family = FAMILIES[item.metadata.family];
    assert.deepEqual(item.metadata.shortcuts, family.shortcuts(item.metadata.instance), item.case_id);
    for (const shortcut of item.metadata.shortcuts) {
      if ('answer' in shortcut) assert.notEqual(shortcut.answer, item.expected, `${item.case_id}: ${shortcut.name}`);
    }
  }
});

test('for each tier 4 and 5 family the shortcut misses on most instances', () => {
  const byFamily = new Map();
  for (const item of generated) {
    const family = FAMILIES[item.metadata.family];
    const miss = family.shortcutMiss(item.metadata.instance, item.expected);
    byFamily.set(item.metadata.family, [...(byFamily.get(item.metadata.family) || []), { id: item.case_id, miss }]);
  }
  assert.ok(byFamily.size >= 6, [...byFamily.keys()].join(', '));
  for (const [name, rows] of byFamily) {
    const wrong = rows.filter((row) => row.miss >= 0.5).length;
    assert.ok(wrong > rows.length / 2, `${name}: the shortcut misses on ${wrong} of ${rows.length} instances (${JSON.stringify(rows)})`);
  }
});

// ---- folded cases -----------------------------------------------------------------------------------

const OLD_SUITES = ['reasoning', 'reasoning-hard'];
function readOld(suite) {
  const roots = [process.env.LADDER_OLD_DIR, path.join(ROOT, 'datasets'), path.join(ROOT, 'datasets', 'archive'), path.join(ROOT, 'datasets', '_archive'), path.join(ROOT, 'archive')].filter(Boolean);
  const tried = roots.map((root) => path.join(root, suite, 'cases.jsonl'));
  const file = tried.find((candidate) => fs.existsSync(candidate));
  assert.ok(file, `old suite ${suite} not found; tried ${tried.join(', ')} (set LADDER_OLD_DIR to the folder that holds it)`);
  return new Map(fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).map((row) => [row.case_id, row]));
}

test('each folded case equals its origin case in the old cases.jsonl', () => {
  assert.equal(folded.length, 10);
  const old = Object.fromEntries(OLD_SUITES.map((suite) => [suite, readOld(suite)]));
  assert.equal(new Set(folded.map((item) => item.metadata.tier.origin)).size, folded.length);
  for (const item of folded) {
    const origin = item.metadata.tier.origin;
    const suite = origin.startsWith('reasoning-hard-') ? 'reasoning-hard' : 'reasoning';
    const row = old[suite].get(origin);
    assert.ok(row, `${item.case_id}: origin ${origin} is not in the old suite`);
    assert.equal(item.input.question, row.input.question, `${item.case_id}: question`);
    assert.deepEqual(item.expected, row.expected, `${item.case_id}: expected`);
    assert.equal(suite, level(item) === 3 ? 'reasoning-hard' : 'reasoning', `${item.case_id}: tiers 1 and 2 come from reasoning, tier 3 from reasoning-hard`);
  }
});

test('folded hard cases solve again from their stored instance, with one answer', () => {
  const hard = folded.filter((item) => level(item) === 3);
  assert.equal(hard.length, 5);
  for (const item of hard) {
    const { family, instance } = item.metadata;
    const solved = OLD_SOLVERS[family](instance);
    assert.deepEqual(solved.answers, [item.expected], item.case_id);
    if ('solutions' in solved) assert.equal(solved.solutions, 1, `${item.case_id}: not unique`);
  }
});

test('the folded easy cases are checked by arithmetic, not by trust', () => {
  const byId = Object.fromEntries(folded.map((item) => [item.metadata.tier.origin, item.expected]));
  assert.equal(byId['reasoning-train-meet'], 300 / (70 + 80));
  assert.equal(byId['reasoning-odd-sum'], 50 * 50);
  // Committees of 5 from 12 with at least 2 seniors (6 seniors, 6 juniors), not both Ana and Ben.
  const choose = (n, k) => (k < 0 || k > n ? 0 : k === 0 ? 1 : (choose(n - 1, k - 1) * n) / k);
  let committees = 0;
  for (let seniors = 2; seniors <= 5; seniors += 1) committees += choose(6, seniors) * choose(6, 5 - seniors);
  for (let seniors = 2; seniors <= 5; seniors += 1) committees -= choose(4, seniors - 2) * choose(6, 5 - seniors);
  assert.equal(byId['reasoning-committee-2'], committees);
  const power = (base, exp, mod) => {
    let out = 1;
    for (let i = 0; i < exp; i += 1) out = (out * base) % mod;
    return out;
  };
  assert.equal(byId['reasoning-mod-power-1'], (power(8, 152, 17) + power(2, 347, 17)) % 17);
  // fee 20, 3 GB at 4, 5 GB at 8, the remaining 3 GB at 13, plus 20 percent tax
  assert.equal(byId['reasoning-tiered-bill-1'], Number((((20 + 3 * 4 + 5 * 8 + 3 * 13) * 12) / 10).toFixed(2)));
});
