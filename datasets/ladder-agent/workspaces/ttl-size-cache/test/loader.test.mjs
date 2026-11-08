import test from 'node:test';
import assert from 'node:assert/strict';
import { Cache, getOrLoad } from '../src/index.mjs';

test('the value is loaded once and then served from the cache', async () => {
  const cache = new Cache();
  let calls = 0;
  const load = async (key) => `${key}:${++calls}`;
  assert.equal(await getOrLoad(cache, 'k', load), 'k:1');
  assert.equal(await getOrLoad(cache, 'k', load), 'k:1');
  assert.equal(calls, 1);
});

test('callers that arrive while the value loads share one call', async () => {
  const cache = new Cache();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return 'v';
  };
  const results = await Promise.all([getOrLoad(cache, 'k', load), getOrLoad(cache, 'k', load), getOrLoad(cache, 'k', load)]);
  assert.deepEqual(results, ['v', 'v', 'v']);
  assert.equal(calls, 1);
});
