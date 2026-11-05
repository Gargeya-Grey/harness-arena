import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, manualClock } from '../src/index.mjs';

test('a rule listed first for an exact key beats the catch-all', () => {
  const limiter = createLimiter({
    rules: [{ match: 'admin', burst: 10, perSecond: 5 }, { match: '*', burst: 2, perSecond: 1 }],
    clock: manualClock(0),
  });
  assert.equal(limiter.check('admin').limit, 10);
  assert.equal(limiter.check('guest').limit, 2);
});

test('a prefix rule covers the keys that start with it', () => {
  const limiter = createLimiter({
    rules: [{ match: 'user:*', burst: 4, perSecond: 1 }, { match: '*', burst: 1, perSecond: 1 }],
    clock: manualClock(0),
  });
  assert.equal(limiter.check('user:ann').limit, 4);
  assert.equal(limiter.check('ip:1.2.3.4').limit, 1);
});

test('bad rules are refused', () => {
  assert.throws(() => createLimiter({ rules: [{ match: '*', burst: 0, perSecond: 1 }] }), RangeError);
  assert.throws(() => createLimiter({ rules: [{ match: '*', burst: 1, perSecond: 0 }] }), RangeError);
});
