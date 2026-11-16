// Hidden probes for ladder-agent-ttl-size-cache; expected.json holds the answers.
// Every probe drives the cache through src/index.mjs with a manual clock.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch {
    return 'threw';
  }
};
const sized = (value) => value.n;
const show = (value) => (value === undefined ? 'undefined' : value === Infinity ? 'Infinity' : value);
const make = async (load, options = {}) => {
  const { Cache, manualClock } = await lib(load);
  const clock = manualClock(0);
  return { clock, cache: new Cache({ clock, ...options }) };
};
const alive = (cache, key) => cache.get(key) !== undefined;

export const probes = [
  {
    name: 'keeps basic use and falsy values',
    run: async ({ load }) => {
      const { cache } = await make(load);
      cache.set('z', 0);
      cache.set('e', '');
      cache.set('f', false);
      return [cache.get('z'), cache.get('e'), cache.get('f'), cache.has('z'), cache.has('nope'), cache.size(), cache.delete('z'), cache.delete('z'), cache.size()];
    },
  },
  {
    name: 'keeps least recently used eviction with maxEntries',
    run: async ({ load }) => {
      const { cache } = await make(load, { maxEntries: 3 });
      for (const k of ['a', 'b', 'c']) cache.set(k, k);
      cache.get('a');
      cache.set('d', 'd');
      cache.set('c', 'c2');
      cache.set('e', 'e');
      return [cache.keys(), cache.stats().evictions];
    },
  },
  {
    name: 'durations in text are converted to milliseconds',
    run: async ({ load }) => {
      const { parseDuration } = await lib(load);
      return ['500ms', '30s', '5m', '2h', '1d', '1.5s', '1h30m', '0s', 250, 0, Infinity].map((d) => show(parseDuration(d)));
    },
  },
  {
    name: 'keeps bad durations an error',
    run: async ({ load }) => {
      const { parseDuration } = await lib(load);
      return ['', 'soon', '10x', '-5s', -1, NaN, '5', null, 's'].map((d) => attempt(() => parseDuration(d)));
    },
  },
  {
    name: 'a ttl written as text lasts that many seconds',
    run: async ({ load }) => {
      const { cache, clock } = await make(load, { ttl: '30s' });
      cache.set('a', 1);
      clock.set(29_999);
      const before = cache.get('a');
      clock.set(30_000);
      return [before, cache.get('a'), cache.has('a')];
    },
  },
  {
    name: 'a ttl given per entry beats the default, in text or in milliseconds',
    run: async ({ load }) => {
      const { cache, clock } = await make(load, { ttl: '1m' });
      cache.set('text', 1, { ttl: '2s' });
      cache.set('ms', 2, { ttl: 3000 });
      cache.set('default', 3);
      cache.set('forever', 4, { ttl: Infinity });
      clock.set(1999);
      const a = [alive(cache, 'text'), alive(cache, 'ms'), alive(cache, 'default'), alive(cache, 'forever')];
      clock.set(2000);
      const b = [alive(cache, 'text'), alive(cache, 'ms')];
      clock.set(3000);
      const c = [alive(cache, 'ms'), alive(cache, 'default')];
      clock.set(60_000);
      return [a, b, c, alive(cache, 'default'), alive(cache, 'forever')];
    },
  },
  {
    name: 'an entry expires exactly when its time is up, for every reader',
    run: async ({ load }) => {
      const { cache, clock } = await make(load, { ttl: 100 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      clock.set(99);
      const before = [cache.peek('a'), cache.has('b'), show(cache.ttlOf('c'))];
      clock.set(100);
      return [before, show(cache.peek('a')), cache.has('b'), show(cache.ttlOf('c')), show(cache.get('a')), cache.size()];
    },
  },
  {
    name: 'a ttl of zero expires at once and a bad ttl is refused',
    run: async ({ load }) => {
      const { cache } = await make(load);
      const stored = cache.set('a', 1, { ttl: 0 });
      return [stored, show(cache.get('a')), cache.size(), attempt(() => cache.set('b', 1, { ttl: -5 })), attempt(() => cache.set('b', 1, { ttl: 'soon' })), attempt(() => new cache.constructor({ ttl: 'soon' }))];
    },
  },
  {
    name: 'ttlOf answers in milliseconds',
    run: async ({ load }) => {
      const { cache, clock } = await make(load, { ttl: '10s' });
      cache.set('a', 1);
      cache.set('never', 2, { ttl: Infinity });
      clock.set(2500);
      const left = cache.ttlOf('a');
      clock.set(10_000);
      return [left, show(cache.ttlOf('never')), show(cache.ttlOf('missing')), show(cache.ttlOf('a'))];
    },
  },
  {
    name: 'replacing a key replaces its size',
    run: async ({ load }) => {
      const { cache } = await make(load, { maxBytes: 100, sizeOf: sized });
      for (let i = 0; i < 5; i += 1) cache.set('a', { n: 60 });
      cache.set('b', { n: 40 });
      cache.set('a', { n: 30 });
      cache.set('a', { n: 60 });
      return [cache.bytes(), cache.keys(), cache.stats().evictions];
    },
  },
  {
    name: 'expired entries make room before live ones are evicted',
    run: async ({ load }) => {
      const { cache, clock } = await make(load, { maxBytes: 100, sizeOf: sized });
      cache.set('live', { n: 40 });
      cache.set('short', { n: 40 }, { ttl: 10 });
      clock.set(20);
      cache.set('new', { n: 40 });
      const stats = cache.stats();
      return { keys: cache.keys(), bytes: cache.bytes(), evictions: stats.evictions, expirations: stats.expirations };
    },
  },
  {
    name: 'a value bigger than maxBytes is refused and the old value goes',
    run: async ({ load }) => {
      const { cache } = await make(load, { maxBytes: 100, sizeOf: sized });
      cache.set('keep', { n: 50 });
      cache.set('k', { n: 10 });
      const big = cache.set('big', { n: 150 });
      const replace = cache.set('k', { n: 500 });
      const exact = cache.set('exact', { n: 50 });
      return { big, replace, exact, keys: cache.keys(), bytes: cache.bytes(), evictions: cache.stats().evictions };
    },
  },
  {
    name: 'keeps maxBytes evicting the least recently used entries until the new one fits',
    run: async ({ load }) => {
      const { cache } = await make(load, { maxBytes: 100, sizeOf: sized });
      cache.set('a', { n: 40 });
      cache.set('b', { n: 40 });
      cache.set('c', { n: 20 });
      cache.get('a');
      cache.set('d', { n: 50 });
      return { keys: cache.keys(), bytes: cache.bytes(), evictions: cache.stats().evictions };
    },
  },
  {
    name: 'has and peek leave recency and statistics alone',
    run: async ({ load }) => {
      const { cache } = await make(load, { maxEntries: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.has('a');
      cache.peek('a');
      cache.has('zzz');
      const quiet = cache.stats();
      cache.set('c', 3);
      return { keys: cache.keys(), hits: quiet.hits, misses: quiet.misses };
    },
  },
  {
    name: 'statistics count hits, misses, evictions and expirations',
    run: async ({ load }) => {
      const { cache, clock } = await make(load, { maxEntries: 2, ttl: 100 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a');
      cache.get('x');
      cache.set('c', 3);
      clock.set(100);
      cache.get('a');
      cache.get('c');
      return cache.stats();
    },
  },
  {
    name: 'size and bytes never count expired entries',
    run: async ({ load }) => {
      const { cache, clock } = await make(load, { sizeOf: sized });
      cache.set('a', { n: 10 }, { ttl: 5 });
      cache.set('b', { n: 20 }, { ttl: 5 });
      cache.set('c', { n: 30 });
      clock.set(4);
      const before = [cache.size(), cache.bytes()];
      clock.set(5);
      return [before, cache.size(), cache.bytes(), cache.keys()];
    },
  },
  {
    name: 'purge removes the expired entries and reports how many',
    run: async ({ load }) => {
      const { cache, clock } = await make(load, { sizeOf: sized });
      cache.set('a', { n: 1 }, { ttl: 5 });
      cache.set('b', { n: 1 }, { ttl: 5 });
      cache.set('c', { n: 1 }, { ttl: 9 });
      cache.set('d', { n: 1 });
      clock.set(5);
      const first = cache.purge();
      clock.set(20);
      return [first, cache.purge(), cache.purge(), cache.keys(), cache.stats().expirations];
    },
  },
  {
    name: 'the default size of a string is its UTF-8 length',
    run: async ({ load }) => {
      const { cache } = await make(load, { maxBytes: 10 });
      cache.set('a', 'héllo');
      const first = cache.bytes();
      cache.set('b', '日本');
      return [first, cache.keys(), cache.bytes(), cache.set('c', '😀😀😀')];
    },
  },
  {
    name: 'a loaded value is shared by concurrent callers and reloaded after it expires',
    run: async ({ load }) => {
      const { getOrLoad } = await lib(load);
      const { cache, clock } = await make(load, { ttl: '1s' });
      let calls = 0;
      const loader = async (key) => `${key}#${(calls += 1)}`;
      const together = await Promise.all([getOrLoad(cache, 'k', loader), getOrLoad(cache, 'k', loader), getOrLoad(cache, 'k', loader)]);
      clock.set(999);
      const warm = await getOrLoad(cache, 'k', loader);
      clock.set(1000);
      const cold = await getOrLoad(cache, 'k', loader);
      const custom = await getOrLoad(cache, 'j', loader, { ttl: 50 });
      clock.set(1049);
      const stillCustom = await getOrLoad(cache, 'j', loader);
      clock.set(1050);
      const reloaded = await getOrLoad(cache, 'j', loader);
      return { together, warm, cold, custom, stillCustom, reloaded, calls };
    },
  },
  {
    name: 'a failed load is not cached and waiting callers all see the failure',
    run: async ({ load }) => {
      const { getOrLoad } = await lib(load);
      const { cache } = await make(load);
      let calls = 0;
      const loader = async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return 'ok';
      };
      const settled = await Promise.allSettled([getOrLoad(cache, 'k', loader), getOrLoad(cache, 'k', loader)]);
      const first = settled.map((s) => (s.status === 'rejected' ? `rejected:${s.reason.message}` : s.value));
      const second = await getOrLoad(cache, 'k', loader);
      const third = await getOrLoad(cache, 'k', loader);
      return { first, second, third, calls, has: cache.has('k') };
    },
  },
  {
    name: 'keeps the default clock and the exports',
    run: async ({ load }) => {
      const mod = await lib(load);
      const cache = new mod.Cache({ ttl: '1h' });
      cache.set('a', 'x');
      const names = ['Cache', 'manualClock', 'systemClock', 'parseDuration', 'sizeOf', 'getOrLoad'].filter((n) => !(n in mod));
      return [cache.get('a'), cache.ttlOf('a') > 0, names, mod.sizeOf('abc'), mod.sizeOf({ ab: 'c' })];
    },
  },
  {
    name: 'a synchronous loader throw releases the shared load before retry',
    run: async ({ load }) => {
      const { getOrLoad } = await lib(load);
      const { cache } = await make(load);
      let calls = 0;
      const loader = () => { if (++calls === 1) throw new Error('sync'); return 'ok'; };
      const first = await Promise.allSettled([getOrLoad(cache, 'k', loader)]);
      const next = await getOrLoad(cache, 'k', loader);
      return { first: first.map((value) => value.status), next, calls };
    },
  },
  {
    name: 'a failed cache insertion releases the shared load before retry',
    run: async ({ load }) => {
      const { getOrLoad } = await lib(load);
      let sets = 0;
      let calls = 0;
      const cache = { has: () => false, set: () => { if (++sets === 1) throw new Error('set'); } };
      const first = await Promise.allSettled([getOrLoad(cache, 'k', () => ++calls)]);
      return [first[0].status, await getOrLoad(cache, 'k', () => ++calls), calls];
    },
  },
];
