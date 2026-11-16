const flights = new WeakMap();

// Returns the cached value, or loads it with loader(key) and caches it.
// Callers that ask for the same key while it loads share one call. A load
// that fails is not cached: the next call tries again.
export function getOrLoad(cache, key, loader, options = {}) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (!flights.has(cache)) flights.set(cache, new Map());
  const pending = flights.get(cache);
  if (pending.has(key)) return pending.get(key);
  const flight = Promise.resolve()
    .then(() => loader(key))
    .then((value) => {
      cache.set(key, value, options);
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, flight);
  return flight;
}
