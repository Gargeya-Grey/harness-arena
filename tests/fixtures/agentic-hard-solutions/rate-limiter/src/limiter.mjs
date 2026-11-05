import { createBucket, isFull, take } from './bucket.mjs';
import { systemClock } from './clock.mjs';
import { compileRules, findRule } from './rules.mjs';
import { createStore } from './store.mjs';

// createLimiter({ rules, clock, maxKeys }) -> { check(key, cost = 1), reset(key), size() }
// check() gives { allowed, remaining, limit, retryAfterMs, resetMs }. Every key
// has a bucket of its own; a new key starts with a full bucket.
export function createLimiter({ rules, clock = systemClock, maxKeys = Infinity }) {
  const compiled = compileRules(rules);
  const store = createStore({ maxKeys });
  return {
    check(key, cost = 1) {
      const now = clock.now();
      const rule = findRule(compiled, key);
      let entry = store.get(key);
      if (!entry) {
        store.makeRoom((other) => isFull(other.bucket, other.rule, now));
        entry = { bucket: createBucket(rule, now), rule };
        store.set(key, entry);
      }
      const result = take(entry.bucket, rule, cost, now);
      store.touch(key);
      return result;
    },
    reset(key) {
      return store.delete(key);
    },
    size() {
      return store.size();
    },
  };
}
