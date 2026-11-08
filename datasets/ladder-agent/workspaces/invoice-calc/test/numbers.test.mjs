import test from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceError, allocate, formatMoney, roundDiv } from '../src/index.mjs';

test('a split of 100 into three equal parts gives the extra unit to the first part', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
});

test('a split follows the weights and adds up', () => {
  assert.deepEqual(allocate(10, [1, 2, 3]), [2, 3, 5]);
  assert.deepEqual(allocate(0, [0, 0]), [0, 0]);
  assert.throws(() => allocate(5, [0, 0]), InvoiceError);
});

test('rounding of a division', () => {
  assert.equal(roundDiv(7, 2), 4);
  assert.equal(roundDiv(5, 2, 'half-even'), 2);
  assert.equal(roundDiv(7, 2, 'half-even'), 4);
  assert.equal(roundDiv(10, 3), 3);
});

test('money is written with the decimals of its currency', () => {
  assert.equal(formatMoney(123450, 'USD'), '1,234.50');
  assert.equal(formatMoney(1234, 'JPY'), '1,234');
  assert.equal(formatMoney(1234500, 'KWD'), '1,234.500');
  assert.equal(formatMoney(-5, 'EUR'), '-0.05');
  assert.throws(() => formatMoney(100, 'XXX'), InvoiceError);
});
