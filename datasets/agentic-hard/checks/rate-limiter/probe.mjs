// Hidden probes for agentic-hard-rate-limiter; expected.json holds the answers.
// Every probe drives the limiter through src/index.mjs with a manual clock.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return error.constructor.name;
  }
};
const make = async (load, rules, options = {}) => {
  const { createLimiter, manualClock } = await lib(load);
  const clock = manualClock(0);
  return { clock, limiter: createLimiter({ rules, clock, ...options }) };
};
const one = (burst, perSecond) => [{ match: '*', burst, perSecond }];

export const probes = [
  {
    name: 'keeps a burst, then a refusal, with the documented result shape',
    run: async ({ load }) => {
      const { limiter } = await make(load, one(3, 1));
      const results = [limiter.check('k'), limiter.check('k'), limiter.check('k'), limiter.check('k')];
      return { allowed: results.map((r) => r.allowed), remaining: results.map((r) => r.remaining), keys: Object.keys(results[0]).sort(), limit: results[3].limit };
    },
  },
  {
    name: 'every key has a bucket of its own under one rule',
    run: async ({ load }) => {
      const { limiter } = await make(load, [{ match: 'user:*', burst: 2, perSecond: 1 }]);
      const a = [limiter.check('user:a').allowed, limiter.check('user:a').allowed, limiter.check('user:a').allowed];
      const b = [limiter.check('user:b').allowed, limiter.check('user:b').allowed, limiter.check('user:b').allowed];
      return { a, b, size: limiter.size() };
    },
  },
  {
    name: 'a client that polls faster than the refill interval is let through on time',
    run: async ({ load }) => {
      const { limiter, clock } = await make(load, one(1, 1));
      limiter.check('k');
      const fast = [];
      for (let i = 0; i < 6; i += 1) {
        clock.advance(400);
        fast.push(limiter.check('k').allowed);
      }
      const slow = await make(load, one(1, 0.5));
      slow.limiter.check('k');
      const polls = [];
      for (let i = 0; i < 6; i += 1) {
        slow.clock.advance(700);
        polls.push(slow.limiter.check('k').allowed);
      }
      return { fast, polls };
    },
  },
  {
    name: 'no token arrives early',
    run: async ({ load }) => {
      const out = [];
      for (const at of [1, 499, 500, 501, 999, 1000]) {
        const { limiter, clock } = await make(load, one(1, 1));
        limiter.check('k');
        clock.set(at);
        out.push(limiter.check('k').allowed);
      }
      const { limiter, clock } = await make(load, one(2, 1.5));
      limiter.check('k', 2);
      clock.set(666);
      out.push(limiter.check('k').allowed);
      clock.set(667);
      out.push(limiter.check('k').allowed);
      return out;
    },
  },
  {
    name: 'retryAfterMs is the exact wait, rounded up',
    run: async ({ load }) => {
      const out = [];
      for (const [rule, at, cost] of [[one(1, 1), 0, 1], [one(1, 1), 250, 1], [one(1, 0.3), 0, 1], [one(1, 4), 0, 1], [one(5, 2), 0, 3], [one(1, 0.001), 0, 1]]) {
        const { limiter, clock } = await make(load, rule);
        limiter.check('k', rule[0].burst);
        clock.set(at);
        const r = limiter.check('k', cost);
        out.push([r.allowed, r.retryAfterMs]);
      }
      return out;
    },
  },
  {
    name: 'waiting exactly retryAfterMs is enough, one millisecond less is not',
    run: async ({ load }) => {
      const out = [];
      for (const [burst, perSecond, cost] of [[1, 0.3, 1], [3, 1.5, 3], [2, 0.7, 2], [1, 7, 1], [4, 0.25, 4]]) {
        const a = await make(load, one(burst, perSecond));
        a.limiter.check('k', burst);
        const wait = a.limiter.check('k', cost).retryAfterMs;
        const b = await make(load, one(burst, perSecond));
        b.limiter.check('k', burst);
        b.clock.set(wait - 1);
        const early = b.limiter.check('k', cost).allowed;
        const c = await make(load, one(burst, perSecond));
        c.limiter.check('k', burst);
        c.clock.set(wait);
        out.push([wait, early, c.limiter.check('k', cost).allowed]);
      }
      return out;
    },
  },
  {
    name: 'a refused request takes nothing',
    run: async ({ load }) => {
      const { limiter, clock } = await make(load, one(2, 1));
      limiter.check('k');
      limiter.check('k');
      for (let i = 0; i < 5; i += 1) limiter.check('k');
      limiter.check('k', 2);
      clock.set(1000);
      const first = limiter.check('k');
      const second = limiter.check('k');
      return [first.allowed, second.allowed, second.retryAfterMs];
    },
  },
  {
    name: 'a request that costs more than the burst can never pass and takes nothing',
    run: async ({ load }) => {
      const { limiter } = await make(load, one(3, 1));
      const big = limiter.check('k', 5);
      const after = limiter.check('k', 3);
      const exact = await make(load, one(3, 1));
      return { big: [big.allowed, big.retryAfterMs, big.remaining, big.limit], after: [after.allowed, after.remaining], exact: exact.limiter.check('k', 3).allowed };
    },
  },
  {
    name: 'keeps a cost that is not a whole number refused',
    run: async ({ load }) => {
      const { limiter } = await make(load, one(3, 1));
      return [0, -1, 1.5, NaN, '2'].map((cost) => attempt(() => limiter.check('k', cost)));
    },
  },
  {
    name: 'keeps the bucket at the burst at most',
    run: async ({ load }) => {
      const { limiter, clock } = await make(load, one(3, 1));
      limiter.check('k', 3);
      clock.advance(3_600_000);
      const results = [limiter.check('k'), limiter.check('k'), limiter.check('k'), limiter.check('k')];
      return { allowed: results.map((r) => r.allowed), remaining: results.map((r) => r.remaining) };
    },
  },
  {
    name: 'remaining counts whole tokens and resetMs is the time to a full bucket',
    run: async ({ load }) => {
      const a = await make(load, one(5, 0.5));
      a.limiter.check('k', 5);
      a.clock.set(3000);
      const r = a.limiter.check('k');
      const b = await make(load, one(4, 2));
      const used = b.limiter.check('k', 3);
      const c = await make(load, one(3, 1));
      const fresh = c.limiter.check('k', 1);
      return { r: [r.allowed, r.remaining, r.resetMs], used: [used.remaining, used.resetMs, used.limit], fresh: [fresh.remaining, fresh.resetMs] };
    },
  },
  {
    name: 'the most specific rule wins, whatever the order',
    run: async ({ load }) => {
      const rules = [
        { match: '*', burst: 1, perSecond: 1 },
        { match: 'user:*', burst: 2, perSecond: 1 },
        { match: 'user:vip*', burst: 3, perSecond: 1 },
        { match: 'user:admin', burst: 4, perSecond: 1 },
        { match: 'user:*', burst: 9, perSecond: 1 },
      ];
      const { limiter } = await make(load, rules);
      return ['user:admin', 'user:vip7', 'user:vi', 'user:bob', 'guest', 'user:admin2'].map((key) => limiter.check(key).limit);
    },
  },
  {
    name: 'keeps a key without a rule an error',
    run: async ({ load }) => {
      const { limiter } = await make(load, [{ match: 'a:*', burst: 1, perSecond: 1 }]);
      return [attempt(() => limiter.check('b:1')), limiter.check('a:1').allowed];
    },
  },
  {
    name: 'a clock that moves back does not create tokens',
    run: async ({ load }) => {
      const { limiter, clock } = await make(load, one(1, 1));
      clock.set(10_000);
      limiter.check('k');
      clock.set(5000);
      const back = limiter.check('k').allowed;
      clock.set(10_500);
      const half = limiter.check('k').allowed;
      clock.set(11_000);
      return [back, half, limiter.check('k').allowed];
    },
  },
  {
    name: 'idle full buckets are dropped first when there are too many keys',
    run: async ({ load }) => {
      const { limiter, clock } = await make(load, one(3, 0.5), { maxKeys: 3 });
      limiter.check('a', 3);
      limiter.check('b');
      limiter.check('c');
      clock.set(2000);
      limiter.check('d');
      const size = limiter.size();
      const a = [limiter.check('a').allowed, limiter.check('a').allowed];
      return { size, a, after: limiter.size() };
    },
  },
  {
    name: 'the least recently used key goes when no bucket is full',
    run: async ({ load }) => {
      const { limiter } = await make(load, one(1, 0.001), { maxKeys: 2 });
      limiter.check('a');
      limiter.check('b');
      limiter.check('a');
      limiter.check('c');
      return { size: limiter.size(), a: limiter.check('a').allowed, b: limiter.check('b').allowed };
    },
  },
  {
    name: 'the number of keys never passes maxKeys',
    run: async ({ load }) => {
      const { limiter, clock } = await make(load, one(2, 1), { maxKeys: 10 });
      let most = 0;
      for (let i = 0; i < 200; i += 1) {
        clock.advance(i % 7 === 0 ? 3000 : 5);
        limiter.check(`key${i % 37}`, 1 + (i % 2));
        most = Math.max(most, limiter.size());
      }
      return most;
    },
  },
  {
    name: 'keeps reset giving a key a full bucket',
    run: async ({ load }) => {
      const { limiter } = await make(load, [{ match: 'a', burst: 1, perSecond: 1 }, { match: 'b', burst: 1, perSecond: 1 }]);
      limiter.check('a');
      limiter.check('b');
      const had = limiter.reset('a');
      return [had, limiter.reset('b'), limiter.check('a').allowed, limiter.check('b').allowed, limiter.size()];
    },
  },
  {
    name: 'headers round every time up and leave retry-after to refused requests',
    run: async ({ load }) => {
      const { toHeaders } = await lib(load);
      return [
        toHeaders({ allowed: true, limit: 10, remaining: 7, retryAfterMs: 0, resetMs: 2400 }),
        toHeaders({ allowed: false, limit: 10, remaining: 0, retryAfterMs: 1001, resetMs: 10_000 }),
        toHeaders({ allowed: false, limit: 10, remaining: 0, retryAfterMs: 1, resetMs: 1 }),
        toHeaders({ allowed: false, limit: 3, remaining: 0, retryAfterMs: null, resetMs: 0 }),
      ];
    },
  },
  {
    name: 'the middleware limits by the key it is given and by cost',
    run: async ({ load }) => {
      const { rateLimit } = await lib(load);
      const { limiter } = await make(load, [{ match: 'tenant:*', burst: 2, perSecond: 1 }]);
      const middleware = rateLimit(limiter, { key: (req) => `tenant:${req.headers['x-tenant']}`, cost: (req) => (req.heavy ? 2 : 1) });
      const run = (req) => {
        const res = { headers: {}, statusCode: 200, body: null, setHeader(name, value) { res.headers[name] = value; }, end(body) { res.body = body; } };
        let passed = false;
        middleware(req, res, () => { passed = true; });
        return { passed, status: res.statusCode, retry: res.headers['retry-after'], remaining: res.headers['ratelimit-remaining'] };
      };
      return [run({ ip: '1', headers: { 'x-tenant': 'a' } }), run({ ip: '2', headers: { 'x-tenant': 'a' } }), run({ ip: '3', headers: { 'x-tenant': 'a' } }), run({ ip: '1', headers: { 'x-tenant': 'b' }, heavy: true }), run({ ip: '1', headers: { 'x-tenant': 'b' } })];
    },
  },
  {
    name: 'keeps the exports',
    run: async ({ load }) => {
      const mod = await lib(load);
      return ['createLimiter', 'manualClock', 'systemClock', 'rateLimit', 'toHeaders'].filter((n) => !(n in mod));
    },
  },
];
