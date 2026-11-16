import test from 'node:test';
import assert from 'node:assert/strict';
import { Cart } from '../src/cart.mjs';

test('applyDiscount SAVE10 takes 10 percent off', () => {
  assert.equal(new Cart().add('a', 10).applyDiscount('SAVE10').total(), 9);
});

test('a later discount replaces the previous discount', () => {
  assert.equal(new Cart().add('a', 10).applyDiscount('SAVE10').applyDiscount('FLAT5').total(), 5);
});
