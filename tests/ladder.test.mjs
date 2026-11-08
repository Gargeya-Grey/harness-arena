// The difficulty ladder as stored matches configs/ladder.yaml: every case carries a
// valid tier, its expert time sits inside that tier, each tier holds the agreed
// number of tasks of each kind, and each suite's cases.jsonl is exactly what its
// generate.mjs prints. Per-suite proofs (references pass, wrong answers fail) live in
// tests/ladder-<kind>-*.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { assembleCases, caseProblems, ladderStatus, loadLadder, loadRetired } from '../lab/lib/ladder.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the tier table adds up', () => {
  const ladder = loadLadder(ROOT);
  assert.deepEqual(ladder.tiers.map((tier) => tier.tasks), [5, 10, 15, 20, 30]);
  for (const [index, tier] of ladder.tiers.entries()) {
    if (index > 0) assert.equal(tier.minutes[0], ladder.tiers[index - 1].minutes[1], `${tier.name} starts where the tier below ends`);
  }
});

test('every ladder case fits configs/ladder.yaml, and each tier is full', () => {
  const { problems } = ladderStatus(ROOT);
  assert.deepEqual(problems, []);
});

for (const kind of ['answer', 'code', 'agent']) {
  test(`ladder-${kind}/cases.jsonl is what its generate.mjs prints`, async () => {
    const { buildText } = await import(`../datasets/ladder-${kind}/generate.mjs`);
    const stored = fs.readFileSync(path.join(ROOT, 'datasets', `ladder-${kind}`, 'cases.jsonl'), 'utf8');
    assert.equal(stored, await buildText());
  });
}

test('assembleCases adds the id, tier tag and tier metadata, and sorts by tier', async () => {
  const ladder = loadLadder(ROOT);
  const defs = [
    { slug: 'b-task', file: 'b.mjs', tier: { level: 3, human_minutes: 20, basis: 'timed solve by the author' }, tags: ['logic'], x: 2 },
    { slug: 'a-task', file: 'a.mjs', tier: { level: 1, human_minutes: 1, basis: 'one lookup, timed', origin: 'smoke-001' }, x: 1 },
  ];
  const cases = await assembleCases({ suiteId: 'ladder-answer', defs, ladder, toCase: (def) => ({ input: { question: `q${def.x}` }, expected: def.x }) });
  assert.deepEqual(cases, [
    { case_id: 'ladder-answer-a-task', input: { question: 'q1' }, expected: 1, tags: ['tier-1-easy'], metadata: { tier: { level: 1, name: 'easy', human_minutes: 1, basis: 'one lookup, timed', origin: 'smoke-001' } } },
    { case_id: 'ladder-answer-b-task', input: { question: 'q2' }, expected: 2, tags: ['tier-3-hard', 'logic'], metadata: { tier: { level: 3, name: 'hard', human_minutes: 20, basis: 'timed solve by the author' } } },
  ]);
  for (const item of cases) assert.deepEqual(caseProblems(item, ladder), []);
});

test('assembleCases refuses a repeated slug and an unknown tier', async () => {
  const ladder = loadLadder(ROOT);
  const toCase = () => ({ input: {}, expected: 1 });
  const def = { slug: 'same', file: 'a.mjs', tier: { level: 2, human_minutes: 5, basis: 'timed solve by the author' } };
  await assert.rejects(assembleCases({ suiteId: 's', defs: [def, { ...def, file: 'b.mjs' }], ladder, toCase }), /used twice/);
  await assert.rejects(assembleCases({ suiteId: 's', defs: [{ ...def, tier: { level: 6 } }], ladder, toCase }), /tier.level/);
});

test('a retired task is left out, still checked, and kept with its reason when includeRetired', async () => {
  const ladder = loadLadder(ROOT);
  const calls = [];
  const toCase = (def) => {
    calls.push(def.slug);
    return { input: {}, expected: 1 };
  };
  const tier = { level: 2, human_minutes: 5, basis: 'timed solve by the author' };
  const defs = [{ slug: 'kept', file: 'a.mjs', tier }, { slug: 'gone', file: 'b.mjs', tier }];
  const retired = new Map([['gone', 'Pilot 1: too easy for its tier']]);
  const active = await assembleCases({ suiteId: 's', defs, ladder, toCase, retired });
  assert.deepEqual(active.map((item) => item.case_id), ['s-kept']);
  assert.deepEqual(calls, ['kept'], 'a retired task is not built for the suite');
  const every = await assembleCases({ suiteId: 's', defs, ladder, toCase, retired, includeRetired: true });
  assert.deepEqual(every.map((item) => [item.case_id, item.metadata.tier.retired]), [['s-gone', 'Pilot 1: too easy for its tier'], ['s-kept', undefined]]);
  // A retired slug still counts as taken, and a retired slug with no definition is a typo.
  await assert.rejects(assembleCases({ suiteId: 's', defs: [...defs, { slug: 'gone', file: 'c.mjs', tier }], ladder, toCase, retired }), /used twice/);
  await assert.rejects(assembleCases({ suiteId: 's', defs, ladder, toCase, retired: new Map([['gnoe', 'Pilot 1: too easy for its tier']]) }), /names gnoe, which no definition has/);
  // A retired task with a bad tier is still refused.
  await assert.rejects(assembleCases({ suiteId: 's', defs: [{ slug: 'gone', file: 'b.mjs', tier: { level: 9 } }], ladder, toCase, retired }), /tier.level/);
});

test('loadRetired reads defs/_retired.mjs and refuses a slug without a reason', async () => {
  // One folder per file: a module is cached by its path, so a rewritten file would not load again.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-retired-'));
  const folder = (name, text) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    if (text) fs.writeFileSync(path.join(dir, '_retired.mjs'), text);
    return dir;
  };
  try {
    assert.deepEqual(await loadRetired(folder('none')), new Map(), 'no file: nothing retired');
    assert.deepEqual(await loadRetired(folder('good', "export default { 'old-task': 'Pilot 1: mean 1.0, too easy' };\n")), new Map([['old-task', 'Pilot 1: mean 1.0, too easy']]));
    await assert.rejects(loadRetired(folder('short', "export default { 'old-task': 'easy' };\n")), /"old-task" needs a reason/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a moved case keeps its expert time within a factor of 4 of its new tier, and says where it came from', () => {
  const ladder = loadLadder(ROOT);
  // Tier 3 (hard) is more than 8, at most 30 minutes: a moved task may have 2 to 120.
  const item = (minutes, moved) => ({ case_id: 'm', tags: ['tier-3-hard'], metadata: { tier: { level: 3, name: 'hard', human_minutes: minutes, basis: 'timed solve by the author', moved } } });
  const evidence = 'Pilot 2 (suite 2.0.0): panel mean 0.55';
  assert.deepEqual(caseProblems(item(120, { from: 4, evidence }), ladder), []);
  assert.deepEqual(caseProblems(item(2, { from: 2, evidence }), ladder), []);
  assert.deepEqual(caseProblems(item(121, { from: 5, evidence }), ladder), ['m: human_minutes 121 is more than a factor of 4 outside hard (8 to 30), too far for a moved task']);
  assert.deepEqual(caseProblems(item(60, { from: 3, evidence: 'x' }), ladder), ['m: tier.moved.from must be the level of another tier', 'm: tier.moved.evidence must name the pilot that moved the task']);
  assert.deepEqual(caseProblems(item(60, null), ladder), ['m: tier.moved.from must be the level of another tier', 'm: tier.moved.evidence must name the pilot that moved the task']);
  // Not moved: the strict range still holds.
  assert.deepEqual(caseProblems(item(60), ladder), ['m: human_minutes 60 is outside hard (more than 8, at most 30)']);
});

test('assembleCases copies tier.moved into the case', async () => {
  const ladder = loadLadder(ROOT);
  const moved = { from: 4, evidence: 'Pilot 2 (suite 2.0.0): panel mean 0.55' };
  const [item] = await assembleCases({ suiteId: 's', defs: [{ slug: 'm', file: 'm.mjs', tier: { level: 3, human_minutes: 60, basis: 'timed solve by the author', moved } }], ladder, toCase: () => ({ input: {}, expected: 1 }) });
  assert.deepEqual(item.metadata.tier.moved, moved);
  assert.deepEqual(caseProblems(item, ladder), []);
});

test('caseProblems names a time outside the tier and a missing basis', () => {
  const ladder = loadLadder(ROOT);
  const item = { case_id: 'x', tags: ['tier-4-extra-hard'], metadata: { tier: { level: 4, name: 'extra-hard', human_minutes: 30, basis: '' } } };
  assert.deepEqual(caseProblems(item, ladder), [
    'x: human_minutes 30 is outside extra-hard (more than 30, at most 120)',
    'x: metadata.tier.basis must say how the time was estimated',
  ]);
});
