// Proof for the 13 round-2 answer tasks (datasets/ladder-answer/defs/round2/): exact optimisation
// of one stated instance, answer one whole number. No model call. It checks that
//   - the 13 definitions build through the real generator path (buildCases): 6 at tier 4,
//     7 at tier 5, expert minutes inside the tier range, new slugs, at most 3 per family,
//   - the two exact methods of each family agree on every instance and give the stored answer,
//   - the stored answer passes the suite's evaluator (final-answer@1) and each shortcut's answer fails it,
//     with at least three shortcuts per case and most of them wrong,
//   - the cases of the old definitions are unchanged (byte for byte against cases.jsonl),
//   - the generation of everything stays under 60 s of CPU,
//   - each family has one tiny instance whose optimum is derived by hand below, and both solvers agree.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCases } from '../datasets/ladder-answer/generate.mjs';
import { FAMILIES } from '../datasets/ladder-answer/defs/_families.mjs';
import * as jobs from '../datasets/ladder-answer/defs/_opt-jobs.mjs';
import * as pack from '../datasets/ladder-answer/defs/_opt-pack.mjs';
import * as cover from '../datasets/ladder-answer/defs/_opt-cover.mjs';
import * as binpack from '../datasets/ladder-answer/defs/_opt-binpack.mjs';
import * as steiner from '../datasets/ladder-answer/defs/_opt-steiner.mjs';
import * as edit from '../datasets/ladder-answer/defs/_opt-edit.mjs';
import * as rcpsp from '../datasets/ladder-answer/defs/_opt-rcpsp.mjs';
import { getEvaluator } from '../lab/evaluators/index.mjs';
import { caseProblems, casesText, loadLadder } from '../lab/lib/ladder.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUND2_FAMILIES = ['jobs', 'pack', 'cover', 'binpack', 'steiner', 'edit', 'rcpsp'];
const OLD_SLUGS = [
  'odd-sum', 'train-meet', 'committee-count', 'mod-power', 'tiered-bill', 'hard-congruence', 'hard-knights', 'hard-lattice', 'hard-logic-grid', 'hard-schedule',
  'grid-six-1', 'grid-six-2', 'rook-assignment-1', 'schedule-three-workers-1', 'schedule-three-workers-2', 'square-congruence-1',
  'calendar-years-1', 'calendar-years-2', 'grid-seven-1', 'grid-seven-2', 'route-thirteen-towns', 'route-twelve-towns', 'word-count-1', 'word-count-2',
];
// The two exact methods of each family; they share no code.
const METHODS = {
  jobs: [jobs.jobsDp, jobs.jobsBb],
  pack: [pack.packBb, pack.packEnum],
  cover: [cover.coverBb, cover.coverEnum],
  binpack: [binpack.packDp, binpack.packDfs],
  steiner: [steiner.steinerDp, steiner.steinerEnum],
  edit: [edit.editGotoh, edit.editDijkstra],
  rcpsp: [rcpsp.rcpspSerial, rcpsp.rcpspEvents],
};

const before = process.cpuUsage();
const cases = await buildCases();
const used = process.cpuUsage(before);
const generationCpuMs = (used.user + used.system) / 1000;
const level = (item) => item.metadata.tier.level;
const round2 = cases.filter((item) => ROUND2_FAMILIES.includes(item.metadata.family));
const evaluator = getEvaluator('final-answer', '1');
const verdict = (text, expected) => evaluator.score({ raw: { response: { text } }, testCase: { expected } });

// ---- the 13 definitions ---------------------------------------------------------------------

test('13 round-2 cases build through the generator: 6 at tier 4 and 7 at tier 5', () => {
  assert.equal(round2.length, 13);
  assert.equal(round2.filter((item) => level(item) === 4).length, 6);
  assert.equal(round2.filter((item) => level(item) === 5).length, 7);
});

test('every round-2 case fits the tier table, and its slug is new', () => {
  const ladder = loadLadder(ROOT);
  assert.deepEqual(round2.flatMap((item) => caseProblems(item, ladder)), []);
  for (const item of round2) {
    const slug = item.case_id.replace(/^ladder-answer-/, '');
    assert.ok(!OLD_SLUGS.includes(slug), `${slug} collides with an old slug`);
    assert.ok(item.metadata.tier.human_minutes > (level(item) === 4 ? 30 : 120), item.case_id);
    assert.ok(item.metadata.tier.human_minutes <= (level(item) === 4 ? 120 : 960), item.case_id);
    assert.match(item.metadata.tier.basis, /^Estimate, not timed: /, item.case_id);
  }
  assert.equal(new Set(cases.map((item) => item.case_id)).size, cases.length);
});

test('several families are used, at most 3 tasks per family', () => {
  const counts = {};
  for (const item of round2) counts[item.metadata.family] = (counts[item.metadata.family] || 0) + 1;
  assert.ok(Object.keys(counts).length >= 6, JSON.stringify(counts));
  for (const [family, n] of Object.entries(counts)) assert.ok(n <= 3, `${family}: ${n} tasks`);
});

test('the question states the full instance and asks for one whole number', () => {
  for (const item of round2) {
    const text = item.input.question;
    assert.match(text, /Answer format: a whole number, with no units\.$/, item.case_id);
    assert.ok(Number.isInteger(item.expected) && item.expected > 0, item.case_id);
    assert.equal(FAMILIES[item.metadata.family].render(item.metadata.instance), text, item.case_id);
    assert.deepEqual(JSON.parse(JSON.stringify(item.metadata.instance)), item.metadata.instance, item.case_id);
  }
});

test('generation of all definitions stays under 60 s of CPU', () => {
  assert.ok(generationCpuMs < 60000, `${generationCpuMs} ms`);
});

// ---- exact methods ----------------------------------------------------------------------------------

test('the two exact methods of every family agree on every instance and give the stored answer', () => {
  for (const item of round2) {
    const [a, b] = METHODS[item.metadata.family];
    const instance = item.metadata.instance;
    assert.equal(a(instance), item.expected, `${item.case_id}: first method`);
    assert.equal(b(instance), item.expected, `${item.case_id}: second method`);
    assert.equal(FAMILIES[item.metadata.family].solve(instance).answer, item.expected, item.case_id);
  }
});

// ---- shortcuts and the evaluator --------------------------------------------------------------------

test('the stored answer passes the evaluator and every shortcut answer fails it', () => {
  for (const item of round2) {
    assert.equal(verdict(`Reasoning.\nAnswer: ${item.expected}`, item.expected).passed, true, item.case_id);
    assert.equal(verdict(`${item.expected}`, item.expected).passed, true, item.case_id);
    for (const shortcut of item.metadata.shortcuts) {
      assert.ok(Number.isInteger(shortcut.answer), `${item.case_id}: ${shortcut.name} has no number`);
      assert.equal(verdict(`Answer: ${shortcut.answer}`, item.expected).passed, false, `${item.case_id}: ${shortcut.name}`);
    }
  }
});

test('each case has at least three shortcuts, at least two and most of them wrong, and a near optimum is easy to reach', () => {
  for (const item of round2) {
    const family = FAMILIES[item.metadata.family];
    const list = item.metadata.shortcuts;
    assert.deepEqual(list, family.shortcuts(item.metadata.instance), item.case_id);
    assert.ok(list.length >= 3, item.case_id);
    const wrong = list.filter((s) => s.answer !== item.expected).length;
    // The brief asks for at least two wrong shortcuts and most wrong; these cases are stricter, and
    // tests/ladder-answer.test.mjs asks the same: no shortcut equals the answer.
    assert.ok(wrong >= 2 && wrong === list.length, `${item.case_id}: ${wrong} of ${list.length} shortcuts are wrong`);
    assert.ok(family.shortcutMiss(item.metadata.instance, item.expected) >= 0.5, item.case_id);
    // Every shortcut but the weak bound of rcpsp is a real plan, so none can beat the optimum
    // (a minimum) or exceed it (a maximum, the cargo hold).
    const maximise = item.metadata.family === 'pack';
    for (const s of list) {
      if (item.metadata.family === 'rcpsp' && /ignoring the resource/.test(s.name)) continue;
      assert.ok(maximise ? s.answer <= item.expected : s.answer >= item.expected, `${item.case_id}: ${s.name} beats the optimum`);
    }
    const near = list.some((s) => (maximise ? s.answer >= item.expected * 0.88 : s.answer <= item.expected * 1.25));
    assert.ok(near, `${item.case_id}: no shortcut is near the optimum`);
  }
});

// ---- the old definitions are unchanged --------------------------------------------------------------

test('the cases of the old definitions are byte for byte what cases.jsonl stores', () => {
  const stored = fs.readFileSync(path.join(ROOT, 'datasets', 'ladder-answer', 'cases.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.equal(stored.length, 24);
  const byId = new Map(cases.map((item) => [item.case_id, casesText([item]).trimEnd()]));
  for (const line of stored) {
    const id = JSON.parse(line).case_id;
    assert.equal(byId.get(id), line, `${id} changed`);
  }
  for (const slug of OLD_SLUGS) assert.ok(byId.has(`ladder-answer-${slug}`), slug);
  assert.equal(cases.length, 24 + 13);
});

// ---- hand-checkable tiny instances ---------------------------------------------------------------------

function agree(family, instance, want) {
  const [a, b] = METHODS[family];
  assert.equal(a(instance), want, `${family}: first method`);
  assert.equal(b(instance), want, `${family}: second method`);
  assert.equal(FAMILIES[family].solve(instance).answer, want, `${family}: family solve`);
  assert.match(FAMILIES[family].render(instance), /Answer format: a whole number/, family);
}

test('jobs by hand: three jobs, optimum 26', () => {
  // A: p 2, r 0, w 1.  B: p 3, r 0, w 3.  C: p 1, r 5, w 2.  Setup is 0 except s(A,B) = 4.
  //   B,A,C: B ends 3 (3x3 = 9); A starts 3, ends 5 (1x5 = 5); C starts max(5,5) = 5, ends 6 (2x6 = 12): 26.
  //   B,C,A: 9 + C ends 6 (12) + A ends 8 (8) = 29.     A,B,C: 2 + B starts 2+4 = 6, ends 9 (27) + C ends 10 (20) = 49.
  //   A,C,B: 2 + 12 + B ends 9 (27) = 41.   C,A,B: 12 + 8 + B starts 12, ends 15 (45) = 65.   C,B,A: 12 + 27 + 11 = 50.
  // The smallest is 26.
  const setup = [[0, 4, 0], [0, 0, 0], [0, 0, 0]];
  agree('jobs', { names: ['A', 'B', 'C'], p: [2, 3, 1], w: [1, 3, 2], r: [0, 0, 5], setup }, 26);
});

test('pack by hand: four crates, optimum 15', () => {
  // A: value 10, 5 kg, 5 m3.  B: 7, 4 kg, 2 m3.  C: 6, 3 kg, 3 m3.  D: 5, 3 kg, 1 m3. Limits 8 kg and 6 m3.
  // Shipper 1 = {A, B} and shipper 2 = {C, D}, one crate each at most. B and C are in conflict.
  // Legal loads: A alone 10; B 7; C 6; D 5; A+C is 8 m3 (too much); A+D is 8 kg, 6 m3: 15; B+C conflict; B+D 12.
  // The best is A+D with 15.
  agree('pack', { names: ['A', 'B', 'C', 'D'], value: [10, 7, 6, 5], weight: [5, 4, 3, 3], volume: [5, 2, 3, 1], capW: 8, capV: 6, conflicts: [[1, 2]], shippers: [[0, 1], [2, 3]], limits: [1, 1] }, 15);
});

test('cover by hand: four sites, optimum 8', () => {
  // A cost 5 covers D1, D2.  B cost 4 covers D2, D3.  C cost 3 covers D1.  D cost 3 covers D3. Each district needs one mast.
  // B and C may not both be built. Without that rule B+C = 7 is best. With it:
  // A+D = 8 serves D1, D2 (A) and D3 (D); A+B = 9; C+D leaves D2 open; C+D+A = 11. The best is 8.
  agree('cover', { sites: ['A', 'B', 'C', 'D'], cost: [5, 4, 3, 3], covers: [[0, 1], [1, 2], [0], [2]], districts: ['D1', 'D2', 'D3'], need: [1, 1, 1], conflicts: [[1, 2]] }, 8);
});

test('binpack by hand: five parcels, optimum 10', () => {
  // Sizes 5, 5, 4, 3, 3 (total 20). Boxes: Small holds 8 for 4, Large holds 12 for 6. Parcels 1 and 2 may not share a box.
  // Two boxes can hold 20 only as Large + Small (12 + 8) and cost 10: {5,4,3} in the Large box and {5,3} in the Small box,
  // with the two 5s apart. One box is too small, three boxes cost at least 12. So the optimum is 10.
  agree('binpack', { items: ['P1', 'P2', 'P3', 'P4', 'P5'], size: [5, 5, 4, 3, 3], conflicts: [[0, 1]], boxes: [{ name: 'Small', cap: 8, price: 4 }, { name: 'Large', cap: 12, price: 6 }] }, 10);
});

test('steiner by hand: three depots and one hub, optimum 11', () => {
  // Hub H charges 2 and has routes of 3 to each depot X, Y, Z. The depots also have direct routes of 7 to each other.
  // Through the hub: 3 + 3 + 3 + 2 = 11. Direct: two routes, 14. So the optimum is 11.
  const edges = [[0, 1, 3], [0, 2, 3], [0, 3, 3], [1, 2, 7], [2, 3, 7], [1, 3, 7]];
  agree('steiner', { towns: ['H', 'X', 'Y', 'Z'], depots: [1, 2, 3], fee: [2, 0, 0, 0], edges }, 11);
});

test('edit by hand: three tiny pairs of words', () => {
  const classes = ['aeou', 'dtkp', 'mnrl'];
  // "tam" to "ta": keep t and a, delete m: one run of 1 costs 4 + 1 = 5. Replacing never beats it (a gap letter must go anyway). 5.
  agree('edit', { from: 'tam', to: 'ta', classes }, 5);
  // "tukk" to "tk": keep t; delete the two neighbours u and k as one run (4 + 2 = 6) and keep the last k. Other plans:
  // u and the last k deleted apart (5 + 5 = 10), u replaced by k then "kk" deleted (3 + 6 = 9). The best is 6.
  agree('edit', { from: 'tukk', to: 'tk', classes }, 6);
  // "ta" to "ek": a and t are replaced by letters of their own class (t -> k, a -> e), 1 + 1 = 2 (against 5 + 5 for gaps).
  agree('edit', { from: 'ta', to: 'ke', classes }, 2);
});

test('rcpsp by hand: four tasks, optimum 7', () => {
  // Cap 4 drivers and 1 truck. A: 2 h, 3 drivers.  B: 3 h, 3 drivers.  C: 2 h, 2 drivers and 1 truck.  D: 1 h, 1 driver and 1 truck, after C.
  // A, B and C need 3 + 3, 3 + 2 and 3 + 2 drivers in pairs, over the 4 allowed, so no two of them overlap: at least 2 + 3 + 2 = 7 hours.
  // 7 is reached: C 0-2, then A 2-4 together with D 2-3 (3 + 1 drivers, 1 truck), then B 4-7. So the optimum is 7.
  agree('rcpsp', { names: ['A', 'B', 'C', 'D'], dur: [2, 3, 2, 1], need: [[3, 0], [3, 0], [2, 1], [1, 1]], cap: [4, 1], preds: [[], [], [], [2]] }, 7);
});
