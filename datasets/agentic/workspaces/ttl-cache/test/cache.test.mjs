import test from 'node:test';
import assert from 'node:assert/strict';
import { Cache } from '../src/cache.mjs';

test('set and get', () => {
  const cache = new Cache();
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.size(), 1);
});

test('delete removes an entry', () => {
  const cache = new Cache().set('a', 1);
  assert.equal(cache.delete('a'), true);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size(), 0);
});
