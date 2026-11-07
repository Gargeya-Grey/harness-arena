import { Cache } from './cache.mjs';

// Wraps an async `load(key)` function with a cache.
export function createLoader(load) {
  const cache = new Cache();
  return {
    cache,
    async get(key) {
      if (cache.has(key)) return cache.get(key);
      const value = await load(key);
      cache.set(key, value);
      return value;
    },
  };
}
