import test from 'node:test';
import assert from 'node:assert/strict';
import { Cart } from '../src/cart.mjs';

test('total sums price times quantity', () => {
  assert.equal(new Cart().add('pen', 1.5, 2).add('book', 10).total(), 13);
});

test('an empty cart totals 0', () => {
  assert.equal(new Cart().total(), 0);
});

test('SAVE10 takes 10% off the subtotal', () => {
  const cart = new Cart().add('pen', 1.5, 2).add('book', 10).applyDiscount('SAVE10');
  assert.equal(cart.total(), 11.7);
});

test('FLAT5 takes 5 off the subtotal', () => {
  const cart = new Cart().add('book', 20).applyDiscount('FLAT5');
  assert.equal(cart.total(), 15);
});

test('FLAT5 never takes the total below 0', () => {
  const cart = new Cart().add('pen', 2).applyDiscount('FLAT5');
  assert.equal(cart.total(), 0);
});

test('an empty cart with a discount totals 0', () => {
  assert.equal(new Cart().applyDiscount('SAVE10').total(), 0);
  assert.equal(new Cart().applyDiscount('FLAT5').total(), 0);
});

test('a discount applies to items added after it', () => {
  const cart = new Cart().applyDiscount('FLAT5').add('book', 20);
  assert.equal(cart.total(), 15);
});

test('total with a discount still rounds to cents', () => {
  const cart = new Cart().add('item', 0.99).applyDiscount('SAVE10');
  assert.equal(cart.total(), 0.89);
});

test('applying a code replaces an earlier code', () => {
  const cart = new Cart().add('book', 20).applyDiscount('SAVE10').applyDiscount('FLAT5');
  assert.equal(cart.total(), 15);
});

test('an unknown code throws and keeps the current code', () => {
  const cart = new Cart().add('book', 20).applyDiscount('SAVE10');
  assert.throws(() => cart.applyDiscount('BOGUS'), Error);
  assert.equal(cart.total(), 18);
});

test('an unknown code on a fresh cart throws and applies nothing', () => {
  const cart = new Cart().add('book', 20);
  assert.throws(() => cart.applyDiscount('save10'), Error);
  assert.equal(cart.total(), 20);
});

test('applyDiscount returns the cart for chaining', () => {
  const cart = new Cart();
  assert.equal(cart.applyDiscount('SAVE10'), cart);
});
