import test from 'node:test';
import assert from 'node:assert/strict';
import { toNumber } from '../src/index.mjs';

test('plain numbers', () => {
  assert.equal(toNumber('12.5'), 12.5);
  assert.equal(toNumber('-3'), -3);
  assert.equal(toNumber(' 8 '), 8);
  assert.equal(toNumber('0'), 0);
});

test('text that is no number gives null', () => {
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('n/a'), null);
});
