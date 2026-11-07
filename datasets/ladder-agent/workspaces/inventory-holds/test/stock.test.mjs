import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, UnknownSkuError, createInventory, manualClock } from '../src/index.mjs';

const make = (options = {}) => {
  const inventory = createInventory({ clock: manualClock(0), ...options });
  inventory.receive('A', 5);
  return inventory;
};

test('receive adds to the shelf and writes the ledger', () => {
  const inventory = make();
  inventory.receive('A', 2);
  assert.equal(inventory.snapshot('A').onHand, 7);
  assert.deepEqual(inventory.ledger().map((entry) => entry.qty), [5, 2]);
});

test('an unknown sku is refused', () => {
  const inventory = make();
  assert.throws(() => inventory.snapshot('Z'), UnknownSkuError);
  assert.throws(() => inventory.hold('h', [{ sku: 'Z', qty: 1 }]), UnknownSkuError);
});

test('adjust changes the shelf', () => {
  const inventory = make();
  inventory.adjust('A', -2, 'damaged');
  assert.equal(inventory.snapshot('A').onHand, 3);
});

test('adjust cannot take the shelf below the holds', () => {
  const inventory = make();
  inventory.hold('h1', [{ sku: 'A', qty: 4 }]);
  assert.throws(() => inventory.adjust('A', -2, 'lost'), ConflictError);
});

test('a safety stock is kept back from the buyers', () => {
  const inventory = make({ safety: { A: 2 } });
  assert.equal(inventory.snapshot('A').available, 3);
  assert.equal(inventory.hold('h1', [{ sku: 'A', qty: 4 }]).ok, false);
});
