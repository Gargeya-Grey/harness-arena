import test from 'node:test';
import assert from 'node:assert/strict';
import { Cart } from '../src/cart.mjs';

test('total sums price times quantity', () => {
  assert.equal(new Cart().add('pen', 1.5, 2).add('book', 10).total(), 13);
});

test('an empty cart totals 0', () => {
  assert.equal(new Cart().total(), 0);
});

test('applyDiscount SAVE10 takes 10 percent off', () => {
  assert.equal(new Cart().add('a', 10).applyDiscount('SAVE10').total(), 9);
});
