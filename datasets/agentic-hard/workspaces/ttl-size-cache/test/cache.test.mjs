import test from 'node:test';
import assert from 'node:assert/strict';
import { Cache, manualClock } from '../src/index.mjs';

test('set, get, has, delete, size and clear', () => {
  const cache = new Cache();
  assert.equal(cache.set('a', 1), true);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.get('missing'), undefined);
  assert.equal(cache.size(), 1);
  assert.equal(cache.delete('a'), true);
  assert.equal(cache.delete('a'), false);
  cache.set('b', 0);
  cache.set('c', '');
  assert.equal(cache.get('b'), 0);
  assert.equal(cache.get('c'), '');
  cache.clear();
  assert.equal(cache.size(), 0);
});

test('maxEntries evicts the least recently used entry', () => {
  const cache = new Cache({ maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.deepEqual(cache.keys(), ['a', 'c']);
  assert.equal(cache.get('b'), undefined);
});

test('a number is a time to live in milliseconds', () => {
  const clock = manualClock();
  const cache = new Cache({ ttl: 100, clock });
  cache.set('a', 1);
  clock.advance(99);
  assert.equal(cache.get('a'), 1);
  clock.advance(1);
  assert.equal(cache.get('a'), undefined);
});

test('maxBytes evicts until the new entry fits', () => {
  const cache = new Cache({ maxBytes: 10, sizeOf: (value) => value.length });
  cache.set('a', '12345');
  cache.set('b', '12345');
  cache.set('c', '123');
  assert.deepEqual(cache.keys(), ['b', 'c']);
  assert.equal(cache.bytes(), 8);
});

test('stats count hits, misses and evictions', () => {
  const cache = new Cache({ maxEntries: 1 });
  cache.set('a', 1);
  cache.get('a');
  cache.get('zzz');
  cache.set('b', 2);
  const stats = cache.stats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
  assert.equal(stats.evictions, 1);
  assert.equal(stats.entries, 1);
});
