import { t, rng, randInt } from './_util.mjs';

const rand = rng(31337);
function randomOps(count) {
  const ops = [];
  let time = 0;
  for (let i = 0; i < count; i += 1) {
    time += randInt(rand, 0, 3);
    const key = 'k' + randInt(rand, 0, 5);
    const roll = rand();
    if (roll < 0.45) ops.push(['put', time, key, i]);
    else if (roll < 0.85) ops.push(['get', time, key]);
    else ops.push(['size', time]);
  }
  return ops;
}

export default {
  name: 'simulateCache',
  signature: 'simulateCache(capacity, ttl, ops) -> array',
  kind: 'simulation',
  task: [
    'Simulate a cache that holds at most capacity entries and forgets entries after ttl time units. capacity and ttl are integers of 1 or more.',
    'ops is an array of operations in order; each is ["put", time, key, value], ["get", time, key] or ["size", time]. time is an integer and never decreases from one operation to the next. key is a string; value is any JSON value other than null.',
    'An entry written at time w is expired at time t when t - w >= ttl. Before each operation, every entry that is expired at that operation\'s time is removed.',
    'put: if key is in the cache, overwrite its value and set its write time to the current time, and make it the most recently used entry; otherwise add it as the most recently used entry, and if the cache now holds more than capacity entries, remove the least recently used one.',
    'get: if key is in the cache, return its value and make it the most recently used entry, but do not change its write time (reading does not extend its life); otherwise return null.',
    'size: return the number of entries in the cache.',
    'The result is an array with one element per operation, in order: null for put, the value or null for get, and a number for size.',
  ].join(' '),
  edges: {
    boundary: 't - w >= ttl',
    purge: 'every entry that is expired at that operation',
    overwrite: 'overwrite its value and set its write time',
    'lru-eviction': 'remove the least recently used one',
    'get-recency': 'make it the most recently used entry',
    'get-no-refresh': 'reading does not extend its life',
    size: 'return the number of entries in the cache',
  },
  tests: [
    t('basic', [2, 10, [['put', 0, 'a', 1], ['put', 1, 'b', 2], ['get', 2, 'a'], ['size', 3]]], [null, null, 1, 2]),
    t('get-recency', [2, 100, [['put', 0, 'a', 1], ['put', 1, 'b', 2], ['get', 2, 'a'], ['put', 3, 'c', 3], ['get', 4, 'b'], ['get', 5, 'a'], ['get', 6, 'c']]], [null, null, 1, null, null, 1, 3]),
    t('boundary', [5, 5, [['put', 0, 'a', 1], ['get', 4, 'a'], ['get', 5, 'a']]], [null, 1, null]),
    t('get-no-refresh', [5, 5, [['put', 0, 'a', 1], ['get', 4, 'a'], ['get', 8, 'a']]], [null, 1, null]),
    t('overwrite', [5, 5, [['put', 0, 'a', 1], ['put', 4, 'a', 2], ['get', 8, 'a'], ['get', 9, 'a']]], [null, null, 2, null]),
    t('size', [5, 3, [['put', 0, 'a', 1], ['put', 1, 'b', 2], ['size', 2], ['size', 3], ['size', 4], ['size', 10]]], [null, null, 2, 1, 0, 0]),
    t('purge', [2, 2, [['put', 0, 'a', 1], ['put', 1, 'b', 2], ['get', 1, 'a'], ['put', 2, 'c', 3], ['get', 2, 'b'], ['get', 2, 'c'], ['get', 2, 'a']]], [null, null, 1, null, 2, 3, null]),
    t('overwrite', [2, 100, [['put', 0, 'a', 1], ['put', 0, 'b', 2], ['put', 1, 'a', 3], ['get', 1, 'b'], ['get', 1, 'a']]], [null, null, null, 2, 3]),
    t('lru-eviction', [1, 100, [['put', 0, 'a', 1], ['put', 1, 'b', 2], ['get', 1, 'a'], ['get', 1, 'b']]], [null, null, null, 2]),
    t('basic', [5, 100, [['put', 0, 'k', { x: [1, 2] }], ['get', 1, 'k'], ['put', 1, 'z', false], ['get', 1, 'z'], ['put', 2, 'e', 0], ['get', 2, 'e']]], [null, { x: [1, 2] }, null, false, null, 0]),
    t('size', [3, 5, [['size', 0], ['put', 0, 'a', 1], ['size', 0]]], [0, null, 1]),
    t('basic', [3, 5, [['get', 5, 'nope']]], [null]),
    t('get-recency', [2, 100, [['put', 0, 'a', 1], ['put', 1, 'b', 2], ['get', 2, 'a'], ['put', 3, 'c', 3], ['get', 4, 'a'], ['get', 4, 'b'], ['get', 4, 'c']]], [null, null, 1, null, 1, null, 3]),
    t('boundary', [2, 2, [['put', 0, 'a', 1], ['get', 2, 'a'], ['put', 2, 'a', 5], ['get', 3, 'a'], ['size', 3]]], [null, null, null, 5, 1]),
    t('basic', [3, 4, randomOps(40)]),
    t('basic', [2, 6, randomOps(60)]),
    t('basic', [4, 3, randomOps(60)]),
  ],
};
