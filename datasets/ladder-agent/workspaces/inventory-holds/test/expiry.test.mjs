import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventory, manualClock } from '../src/index.mjs';

const make = () => {
  const clock = manualClock(0);
  const inventory = createInventory({ clock, holdTtlMs: 1000, maxHoldMs: 5000 });
  inventory.receive('A', 5);
  return { clock, inventory };
};

test('an expired hold stops keeping stock back', () => {
  const { clock, inventory } = make();
  inventory.hold('h1', [{ sku: 'A', qty: 4 }]);
  clock.set(2000);
  assert.deepEqual(inventory.snapshot('A'), { onHand: 5, held: 0, available: 5 });
});

test('an expired hold frees the stock for the next hold', () => {
  const { clock, inventory } = make();
  inventory.hold('h1', [{ sku: 'A', qty: 4 }]);
  clock.set(2000);
  assert.equal(inventory.hold('h2', [{ sku: 'A', qty: 5 }]).ok, true);
});

test('extend moves the end of a hold', () => {
  const { clock, inventory } = make();
  inventory.hold('h1', [{ sku: 'A', qty: 1 }]);
  assert.equal(inventory.extend('h1', 500), true);
  clock.set(1200);
  assert.equal(inventory.snapshot('A').held, 1);
  clock.set(1600);
  assert.equal(inventory.snapshot('A').held, 0);
});

test('expiring lists the holds that end soon', () => {
  const { inventory } = make();
  inventory.hold('h1', [{ sku: 'A', qty: 1 }], { ttlMs: 400 });
  inventory.hold('h2', [{ sku: 'A', qty: 1 }], { ttlMs: 900 });
  assert.deepEqual(inventory.expiring(500), [{ id: 'h1', expiresAt: 400 }]);
});

test('a hold id can be used again after the hold expired', () => {
  const { clock, inventory } = make();
  inventory.hold('h1', [{ sku: 'A', qty: 1 }]);
  clock.set(5000);
  assert.equal(inventory.hold('h1', [{ sku: 'A', qty: 2 }]).ok, true);
});
