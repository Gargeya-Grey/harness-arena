import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/index.mjs';

test('a number is milliseconds', () => {
  assert.equal(parseDuration(1500), 1500);
  assert.equal(parseDuration(0), 0);
  assert.equal(parseDuration(Infinity), Infinity);
});

test('bad durations are refused', () => {
  assert.throws(() => parseDuration(-1), RangeError);
  assert.throws(() => parseDuration('soon'), RangeError);
  assert.throws(() => parseDuration(''), RangeError);
});

test('text with a unit is converted to milliseconds', () => {
  assert.equal(parseDuration('2s'), 2000);
  assert.equal(parseDuration('1m'), 60000);
});
