import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, convert, exponent, feeFor, format, RateTable, toMinor } from '../src/index.mjs';

test('toMinor and format round trip for two-digit currencies', () => {
  assert.equal(toMinor('12.34', 'USD'), 1234);
  assert.equal(toMinor('7', 'EUR'), 700);
  assert.equal(format(123456, 'USD'), '1234.56 USD');
  assert.equal(format(700, 'EUR'), '7.00 EUR');
});

test('currencies know their digits', () => {
  assert.equal(exponent('USD'), 2);
  assert.throws(() => exponent('XXX'), /unknown currency/);
  assert.throws(() => toMinor('1.234', 'USD'), /too many decimals/);
});

test('convert between two-digit currencies', () => {
  const rates = new RateTable({ 'EUR>USD': '1.0850' });
  assert.equal(rates.rate('EUR', 'USD'), 1.085);
  assert.equal(convert(10000, 'EUR', 'USD', rates), 10850);
  assert.equal(convert(10850, 'USD', 'EUR', rates), 10000);
  assert.equal(convert(500, 'USD', 'USD', rates), 500);
  assert.throws(() => convert(100, 'EUR', 'GBP', rates), /no rate/);
});

test('fee schedule', () => {
  assert.equal(feeFor(10000, { bps: 25, flat: 30 }), 55);
  assert.equal(feeFor(10000), 0);
});

test('allocate splits evenly when it can', () => {
  assert.deepEqual(allocate(100, [1, 1]), [50, 50]);
  assert.deepEqual(allocate(90, [1, 2]), [30, 60]);
  assert.throws(() => allocate(10, []), /nothing/);
});
