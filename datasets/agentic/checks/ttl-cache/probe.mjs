// Hidden probes for agentic-ttl-cache; expected.json holds the answers.
// Every probe drives the cache with a fake clock, so no probe waits.
const clock = (start = 0) => {
  const c = { t: start, now: () => c.t };
  return c;
};
const make = async (load, options) => {
  const { Cache } = await load('src/cache.mjs');
  return new Cache(options);
};

export const probes = [
  {
    name: 'without ttlMs nothing expires',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { now: c.now });
      cache.set('a', 'v');
      c.t = 1e12;
      return cache.get('a');
    },
  },
  {
    name: 'alive just before the time is up',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { ttlMs: 100, now: c.now });
      cache.set('a', 'v');
      c.t = 99;
      return cache.get('a');
    },
  },
  {
    name: 'expired exactly when the time is up',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { ttlMs: 100, now: c.now });
      cache.set('a', 'v');
      c.t = 100;
      return cache.get('a') === undefined ? 'expired' : 'alive';
    },
  },
  {
    name: 'ttlMs 0 expires at once',
    run: async ({ load }) => {
      const c = clock(5);
      const cache = await make(load, { ttlMs: 0, now: c.now });
      cache.set('a', 'v');
      return cache.get('a') === undefined ? 'expired' : 'alive';
    },
  },
  {
    name: 'a per-entry ttl beats the cache ttl',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { ttlMs: 100, now: c.now });
      cache.set('a', 1, 50);
      cache.set('b', 2);
      c.t = 50;
      return [cache.get('a') === undefined ? 'expired' : 'alive', cache.get('b')];
    },
  },
  {
    name: 'a per-entry Infinity never expires',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { ttlMs: 100, now: c.now });
      cache.set('a', 1, Infinity);
      c.t = 1e9;
      return cache.get('a');
    },
  },
  {
    name: 'setting a key again restarts its time',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { ttlMs: 100, now: c.now });
      cache.set('a', 'old');
      c.t = 60;
      cache.set('a', 'new');
      c.t = 130;
      return cache.get('a');
    },
  },
  {
    name: 'has ignores an expired entry',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { ttlMs: 10, now: c.now });
      cache.set('a', 1);
      const before = cache.has('a');
      c.t = 10;
      return [before, cache.has('a')];
    },
  },
  {
    name: 'size counts live entries only',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { now: c.now });
      cache.set('a', 1, 10);
      cache.set('b', 2);
      c.t = 20;
      return cache.size();
    },
  },
  {
    name: 'purge returns how many it removed and keeps live entries',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { ttlMs: 10, now: c.now });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3, Infinity);
      c.t = 20;
      const removed = cache.purge();
      return [removed, cache.size(), cache.get('c'), cache.purge()];
    },
  },
  {
    name: 'get removes the expired entry it finds',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { ttlMs: 10, now: c.now });
      cache.set('a', 1);
      cache.set('b', 2);
      c.t = 20;
      cache.get('a');
      return cache.purge();
    },
  },
  {
    name: 'falsy values are kept',
    run: async ({ load }) => {
      const c = clock();
      const cache = await make(load, { ttlMs: 100, now: c.now });
      cache.set('z', 0);
      cache.set('e', '');
      return [cache.get('z'), cache.has('z'), cache.get('e'), cache.has('e')];
    },
  },
  {
    name: 'the loader loads again once the value has expired',
    run: async ({ load }) => {
      const c = clock();
      const { createLoader } = await load('src/loader.mjs');
      let calls = 0;
      const loader = createLoader(async (key) => `${key}#${++calls}`, { ttlMs: 100, now: c.now });
      const seen = [];
      for (const t of [0, 50, 100, 101]) {
        c.t = t;
        seen.push(await loader.get('k'));
      }
      return { seen, calls };
    },
  },
  {
    name: 'the loader without options caches for good',
    run: async ({ load }) => {
      const { createLoader } = await load('src/loader.mjs');
      let calls = 0;
      const loader = createLoader(async () => ++calls);
      await loader.get('k');
      await loader.get('k');
      return calls;
    },
  },
];
