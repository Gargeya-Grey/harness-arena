import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, manualClock } from '../src/index.mjs';

const make = (rule, options = {}) => {
  const clock = manualClock(0);
  return { clock, limiter: createLimiter({ rules: [{ match: '*', ...rule }], clock, ...options }) };
};

test('a burst is allowed, then refused', () => {
  const { limiter } = make({ burst: 3, perSecond: 1 });
  assert.deepEqual([1, 2, 3].map(() => limiter.check('k').allowed), [true, true, true]);
  const refused = limiter.check('k');
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.equal(refused.limit, 3);
});

test('remaining counts down', () => {
  const { limiter } = make({ burst: 3, perSecond: 1 });
  assert.deepEqual([1, 2, 3].map(() => limiter.check('k').remaining), [2, 1, 0]);
});

test('one token comes back every second at one per second', () => {
  const { limiter, clock } = make({ burst: 2, perSecond: 1 });
  limiter.check('k');
  limiter.check('k');
  assert.equal(limiter.check('k').allowed, false);
  clock.advance(1000);
  assert.equal(limiter.check('k').allowed, true);
  assert.equal(limiter.check('k').allowed, false);
});

test('different rules keep different buckets', () => {
  const clock = manualClock(0);
  const limiter = createLimiter({ rules: [{ match: 'login', burst: 1, perSecond: 1 }, { match: 'search', burst: 1, perSecond: 1 }], clock });
  assert.equal(limiter.check('login').allowed, true);
  assert.equal(limiter.check('login').allowed, false);
  assert.equal(limiter.check('search').allowed, true);
});

test('a request that costs more takes more', () => {
  const { limiter } = make({ burst: 5, perSecond: 1 });
  assert.equal(limiter.check('k', 3).remaining, 2);
  assert.equal(limiter.check('k', 3).allowed, false);
});

test('a client that polls faster than the refill interval still gets its turn', () => {
  const { limiter, clock } = make({ burst: 1, perSecond: 1 });
  limiter.check('k');
  const polls = [];
  for (let i = 0; i < 6; i += 1) {
    clock.advance(400);
    polls.push(limiter.check('k').allowed);
  }
  assert.ok(polls.includes(true), `never allowed: ${polls}`);
});

test('reset forgets a key and size counts keys', () => {
  const limiter = createLimiter({ rules: [{ match: 'a', burst: 1, perSecond: 1 }, { match: 'b', burst: 1, perSecond: 1 }], clock: manualClock(0) });
  limiter.check('a');
  limiter.check('b');
  assert.equal(limiter.size(), 2);
  assert.equal(limiter.check('a').allowed, false);
  assert.equal(limiter.reset('a'), true);
  assert.equal(limiter.check('a').allowed, true);
});
