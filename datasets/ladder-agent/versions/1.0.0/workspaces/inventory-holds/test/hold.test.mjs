import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, createInventory, manualClock } from '../src/index.mjs';

const make = (options = {}) => {
  const clock = manualClock(0);
  const inventory = createInventory({ clock, holdTtlMs: 1000, maxHoldMs: 5000, ...options });
  inventory.receive('A', 5);
  inventory.receive('B', 2);
  return { clock, inventory };
};

test('a hold keeps stock back from the next buyer', () => {
  const { inventory } = make();
  const first = inventory.hold('h1', [{ sku: 'A', qty: 3 }]);
  assert.equal(first.ok, true);
  assert.deepEqual(inventory.snapshot('A'), { onHand: 5, held: 3, available: 2 });
  const second = inventory.hold('h2', [{ sku: 'A', qty: 3 }]);
  assert.equal(second.ok, false);
  assert.deepEqual(second.short, [{ sku: 'A', wanted: 3, available: 2 }]);
});

test('the same id with the same lines is a replay', () => {
  const { inventory } = make();
  inventory.hold('h1', [{ sku: 'A', qty: 3 }]);
  const again = inventory.hold('h1', [{ sku: 'A', qty: 3 }]);
  assert.equal(again.replay, true);
  assert.equal(inventory.snapshot('A').held, 3);
});

test('the same id with other lines is a conflict', () => {
  const { inventory } = make();
  inventory.hold('h1', [{ sku: 'A', qty: 3 }]);
  assert.throws(() => inventory.hold('h1', [{ sku: 'A', qty: 1 }]), ConflictError);
});

test('commit takes the stock out of the shelf', () => {
  const { inventory } = make();
  inventory.hold('h1', [{ sku: 'A', qty: 3 }]);
  assert.equal(inventory.commit('h1'), true);
  assert.deepEqual(inventory.snapshot('A'), { onHand: 2, held: 0, available: 2 });
  assert.equal(inventory.commit('h1'), false);
});

test('release gives the stock back', () => {
  const { inventory } = make();
  inventory.hold('h1', [{ sku: 'B', qty: 2 }]);
  assert.equal(inventory.release('h1'), true);
  assert.equal(inventory.snapshot('B').available, 2);
});

test('bad lines are refused', () => {
  const { inventory } = make();
  assert.throws(() => inventory.hold('h1', []), RangeError);
  assert.throws(() => inventory.hold('h1', [{ sku: 'A', qty: 0 }]), RangeError);
});
