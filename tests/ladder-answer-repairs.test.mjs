import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCases } from '../datasets/ladder-answer/generate.mjs';

const all = await buildCases({ includeRetired: true });
const active = all.filter(item => !item.metadata.tier.retired);
const repaired = [
  'ladder-answer-box-shipping-conflict-thirteen',
  'ladder-answer-box-shipping-conflict-seventeen',
  'ladder-answer-building-resource-fourteen',
];
const replaced = [
  'ladder-answer-box-shipping-thirteen-parcels',
  'ladder-answer-box-shipping-seventeen-parcels',
  'ladder-answer-building-fourteen-tasks',
];

function cliqueBound(weights, incompatible) {
  const count = weights.length;
  const size = 1 << count;
  const valid = new Uint8Array(size);
  const sums = new Float64Array(size);
  const adjacent = weights.map((_, i) => weights.reduce((mask, value, j) => incompatible(i, j) ? mask | 1 << j : mask, 0));
  valid[0] = 1;
  let best = 0;
  for (let mask = 1; mask < size; mask += 1) {
    const low = mask & -mask;
    const index = 31 - Math.clz32(low);
    const rest = mask ^ low;
    sums[mask] = sums[rest] + weights[index];
    valid[mask] = valid[rest] && (adjacent[index] & rest) === rest ? 1 : 0;
    if (valid[mask]) best = Math.max(best, sums[mask]);
  }
  return best;
}

function independentBounds(family, instance) {
  if (family === 'binpack') {
    const total = instance.size.reduce((sum, value) => sum + value, 0);
    const [first, second, third] = instance.boxes;
    const maximum = Math.ceil(total / Math.min(first.cap, second.cap, third.cap)) + 1;
    let capacityPrice = Infinity;
    for (let a = 0; a <= maximum; a += 1) for (let b = 0; b <= maximum; b += 1) for (let c = 0; c <= maximum; c += 1) {
      if (a * first.cap + b * second.cap + c * third.cap >= total) capacityPrice = Math.min(capacityPrice, a * first.price + b * second.price + c * third.price);
    }
    const cap = Math.max(...instance.boxes.map(box => box.cap));
    const conflicts = new Set(instance.conflicts.flatMap(([a, b]) => [`${a}:${b}`, `${b}:${a}`]));
    const minimumPrices = instance.size.map(value => Math.min(...instance.boxes.filter(box => box.cap >= value).map(box => box.price)));
    return { capacity_price: capacityPrice, separate_boxes: cliqueBound(minimumPrices, (a, b) => a !== b && (conflicts.has(`${a}:${b}`) || instance.size[a] + instance.size[b] > cap)) };
  }
  const finish = [];
  for (let i = 0; i < instance.names.length; i += 1) finish[i] = instance.dur[i] + Math.max(0, ...instance.preds[i].map(index => finish[index]));
  return {
    critical_path: Math.max(...finish),
    resource_0: Math.ceil(instance.dur.reduce((sum, duration, index) => sum + duration * instance.need[index][0], 0) / instance.cap[0]),
    resource_1: Math.ceil(instance.dur.reduce((sum, duration, index) => sum + duration * instance.need[index][1], 0) / instance.cap[1]),
    incompatible_tasks: cliqueBound(instance.dur, (a, b) => a !== b && instance.cap.some((capacity, resource) => instance.need[a][resource] + instance.need[b][resource] > capacity)),
  };
}

test('active repaired packing and building instances have a gap beyond the audited certificate shortcuts', () => {
  const selected = active.filter(item => item.metadata.family === 'binpack' || [...replaced, ...repaired].includes(item.case_id) && item.metadata.family === 'rcpsp');
  assert.equal(selected.length, 3);
  for (const item of selected) {
    const bounds = independentBounds(item.metadata.family, item.metadata.instance);
    assert(Math.max(...Object.values(bounds)) < item.expected, `${item.case_id}: a tested bound already certifies ${item.expected}`);
  }
});

test('three replacement IDs take the old tier slots while the old instances remain retired and provable', () => {
  for (let index = 0; index < replaced.length; index += 1) {
    const previous = all.find(item => item.case_id === replaced[index]);
    const current = active.find(item => item.case_id === repaired[index]);
    assert(previous?.metadata.tier.retired, `${replaced[index]} must be retained as retired`);
    assert(current, `${repaired[index]} must be active`);
    assert.equal(current.metadata.tier.level, previous.metadata.tier.level);
    assert.equal(current.metadata.difficulty_review.timing, 'unmeasured');
    assert.match(current.metadata.tier.basis, /not timed|unmeasured/i);
  }
});

test('the retired concrete certificate defects reproduce and the active metadata records independently checked gaps', async () => {
  const { certificateReview } = await import('../datasets/ladder-answer/defs/_certificate-review.mjs');
  for (const [id, answer] of replaced.map((id, index) => [id, [48, 66, 41][index]])) {
    const item = all.find(value => value.case_id === id);
    const reviewed = certificateReview(item.metadata.family, item.metadata.instance, item.expected);
    assert.equal(item.expected, answer);
    assert.equal(reviewed.strongest_bound, answer);
    assert.equal(reviewed.gap, 0);
  }
  for (const id of repaired) {
    const item = active.find(value => value.case_id === id);
    const reviewed = certificateReview(item.metadata.family, item.metadata.instance, item.expected);
    assert.deepEqual(reviewed.bounds, independentBounds(item.metadata.family, item.metadata.instance));
    assert.deepEqual(item.metadata.difficulty_review.bounds, reviewed.bounds);
    assert.equal(item.metadata.difficulty_review.gap, item.expected - reviewed.strongest_bound);
    assert(item.metadata.difficulty_review.gap > 0);
    assert.match(item.metadata.difficulty_review.scope, /only|not.*tim/i);
  }
});

test('replacement feasible witnesses attain the independently solved answers', () => {
  for (const id of repaired) {
    const item = active.find(value => value.case_id === id);
    const instance = item.metadata.instance;
    const witness = item.metadata.feasible_witness;
    if (item.metadata.family === 'binpack') {
      const packed = witness.boxes.flatMap(box => box.items);
      assert.deepEqual([...packed].sort(), [...instance.items].sort());
      let cost = 0;
      for (const box of witness.boxes) {
        const type = instance.boxes.find(value => value.name === box.type);
        const indexes = box.items.map(name => instance.items.indexOf(name));
        assert(indexes.every(index => index >= 0));
        assert(indexes.reduce((sum, index) => sum + instance.size[index], 0) <= type.cap);
        assert(instance.conflicts.every(([a, b]) => !indexes.includes(a) || !indexes.includes(b)));
        cost += type.price;
      }
      assert.equal(cost, item.expected);
      assert.equal(witness.cost, item.expected);
    } else {
      const starts = instance.names.map(name => witness.starts[name]);
      assert(starts.every(start => Number.isInteger(start) && start >= 0));
      for (let index = 0; index < starts.length; index += 1) for (const predecessor of instance.preds[index]) assert(starts[index] >= starts[predecessor] + instance.dur[predecessor]);
      const makespan = Math.max(...starts.map((start, index) => start + instance.dur[index]));
      assert.equal(makespan, item.expected);
      assert.equal(witness.makespan, item.expected);
      for (let hour = 0; hour < makespan; hour += 1) for (let resource = 0; resource < instance.cap.length; resource += 1) {
        const used = starts.reduce((sum, start, index) => sum + (start <= hour && hour < start + instance.dur[index] ? instance.need[index][resource] : 0), 0);
        assert(used <= instance.cap[resource]);
      }
    }
  }
});
