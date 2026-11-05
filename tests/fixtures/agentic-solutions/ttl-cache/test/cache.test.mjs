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

test('an entry expires when ttlMs has passed', () => {
  let t = 0;
  const cache = new Cache({ ttlMs: 100, now: () => t });
  cache.set('a', 1);
  t = 99;
  assert.equal(cache.get('a'), 1);
  t = 100;
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size(), 0);
});

test('purge removes expired entries and counts them', () => {
  let t = 0;
  const cache = new Cache({ ttlMs: 10, now: () => t });
  cache.set('a', 1).set('b', 2, Infinity);
  t = 10;
  assert.equal(cache.purge(), 1);
  assert.equal(cache.get('b'), 2);
});
