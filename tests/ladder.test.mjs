// The difficulty ladder as stored matches configs/ladder.yaml: every case carries a
// valid tier, its expert time sits inside that tier, each tier holds the agreed
// number of tasks of each kind, and each suite's cases.jsonl is exactly what its
// generate.mjs prints. Per-suite proofs (references pass, wrong answers fail) live in
// tests/ladder-<kind>-*.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assembleCases, caseProblems, ladderStatus, loadLadder } from '../lab/lib/ladder.mjs';

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

test('caseProblems names a time outside the tier and a missing basis', () => {
  const ladder = loadLadder(ROOT);
  const item = { case_id: 'x', tags: ['tier-4-extra-hard'], metadata: { tier: { level: 4, name: 'extra-hard', human_minutes: 30, basis: '' } } };
  assert.deepEqual(caseProblems(item, ladder), [
    'x: human_minutes 30 is outside extra-hard (more than 30, at most 120)',
    'x: metadata.tier.basis must say how the time was estimated',
  ]);
});
