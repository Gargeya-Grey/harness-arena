import { createBucket, take } from './bucket.mjs';
import { systemClock } from './clock.mjs';
import { compileRules, findRule } from './rules.mjs';
import { createStore } from './store.mjs';

// createLimiter({ rules, clock, maxKeys }) -> { check(key, cost = 1), reset(key), size() }
// check() gives { allowed, remaining, limit, retryAfterMs, resetMs }.
export function createLimiter({ rules, clock = systemClock, maxKeys = Infinity }) {
  const compiled = compileRules(rules);
  const store = createStore({ maxKeys });
  return {
    check(key, cost = 1) {
      const now = clock.now();
      const rule = findRule(compiled, key);
      const id = rule.match;
      let entry = store.get(id);
      if (!entry) {
        entry = { bucket: createBucket(rule, now), rule };
        store.set(id, entry);
      }
      return take(entry.bucket, rule, cost, now);
    },
    reset(key) {
      return store.delete(findRule(compiled, key).match);
    },
    size() {
      return store.size();
    },
  };
}
