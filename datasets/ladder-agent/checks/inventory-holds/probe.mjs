// Hidden probes for ladder-agent-inventory-holds; expected.json holds the answers.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return error.constructor.name;
  }
};
const lines = (...pairs) => pairs.map(([sku, qty]) => ({ sku, qty }));
const make = async (load, options = {}, stock = { A: 5, B: 2, C: 10 }) => {
  const { createInventory, manualClock } = await lib(load);
  const clock = manualClock(0);
  const inv = createInventory({ clock, holdTtlMs: 1000, maxHoldMs: 5000, ...options });
  for (const [sku, qty] of Object.entries(stock)) inv.receive(sku, qty);
  return { clock, inv };
};
const state = (inv, sku) => {
  const s = inv.snapshot(sku);
  return [s.onHand, s.held, s.available];
};

export const probes = [
  {
    name: 'keeps a hold, a second buyer and the shape of the result',
    run: async ({ load }) => {
      const { inv } = await make(load);
      const first = inv.hold('h1', lines(['A', 3]));
      const second = inv.hold('h2', lines(['A', 3]));
      return { first: [first.ok, first.replay, Object.keys(first.hold).sort(), first.hold.lines, first.hold.expiresAt], second, snap: state(inv, 'A'), keys: Object.keys(inv.snapshot('A')).sort() };
    },
  },
  {
    name: 'a hold ends exactly at its expiry time and not a moment later',
    run: async ({ load }) => {
      const { inv, clock } = await make(load);
      inv.hold('h1', lines(['A', 3]));
      const out = {};
      clock.set(999);
      out.before = state(inv, 'A');
      clock.set(1000);
      out.at = state(inv, 'A');
      out.commit = inv.commit('h1');
      out.next = inv.hold('h2', lines(['A', 5])).ok;
      return out;
    },
  },
  {
    name: 'an expired hold stops counting although nothing else was called since',
    run: async ({ load }) => {
      const { inv, clock } = await make(load);
      inv.hold('h1', lines(['A', 4]));
      clock.set(5000);
      const snap = state(inv, 'A');
      const adjust = attempt(() => inv.adjust('A', -5, 'recount')) ?? 'ok';
      return { snap, adjust, after: state(inv, 'A'), expiring: inv.expiring(100000) };
    },
  },
  {
    name: 'commit, extend and release refuse a hold whose time is up',
    run: async ({ load }) => {
      const { inv, clock } = await make(load, { holdTtlMs: 100 });
      inv.hold('h1', lines(['A', 2]));
      inv.hold('h2', lines(['A', 1]));
      inv.hold('h3', lines(['B', 1]));
      clock.set(100);
      const out = { commit: inv.commit('h1'), extend: inv.extend('h2', 500), release: inv.release('h3') };
      clock.set(150);
      out.later = [inv.commit('h1'), inv.extend('h2', 500)];
      out.state = [state(inv, 'A'), state(inv, 'B')];
      out.ledger = inv.ledger().map((e) => [e.type, e.sku, e.qty]);
      return out;
    },
  },
  {
    name: 'extend adds to the current expiry and a hold never lives longer than the longest life',
    run: async ({ load }) => {
      const { inv, clock } = await make(load, { holdTtlMs: 1000, maxHoldMs: 3000 });
      inv.hold('h1', lines(['A', 1]));
      clock.set(200);
      const out = { first: inv.extend('h1', 500), expiry1: inv.expiring(100000) };
      clock.set(1499);
      out.at1499 = inv.snapshot('A').held;
      clock.set(1500);
      out.at1500 = inv.snapshot('A').held;
      clock.set(0);
      const { inv: other } = await make(load, { holdTtlMs: 1000, maxHoldMs: 3000 });
      other.hold('h1', lines(['A', 1]));
      out.big = other.extend('h1', 5000);
      out.expiry2 = other.expiring(100000);
      out.again = other.extend('h1', 1);
      out.expiry3 = other.expiring(100000);
      return out;
    },
  },
  {
    name: 'the first expiry is the time to live, but not beyond the longest life',
    run: async ({ load }) => {
      const a = await make(load, { holdTtlMs: 9000, maxHoldMs: 4000 });
      const b = await make(load, { holdTtlMs: 1000, maxHoldMs: 4000 });
      return [a.inv.hold('x', lines(['A', 1])).hold.expiresAt, b.inv.hold('x', lines(['A', 1]), { ttlMs: 10_000 }).hold.expiresAt, b.inv.hold('y', lines(['A', 1]), { ttlMs: 250 }).hold.expiresAt];
    },
  },
  {
    name: 'keeps extend, release and commit saying false for a hold that is not active',
    run: async ({ load }) => {
      const { inv } = await make(load);
      inv.hold('rel', lines(['A', 1]));
      inv.release('rel');
      inv.hold('com', lines(['A', 1]));
      inv.commit('com');
      inv.hold('act', lines(['A', 1]));
      return {
        released: [inv.extend('rel', 10), inv.release('rel'), inv.commit('rel')],
        committed: [inv.extend('com', 10), inv.release('com'), inv.commit('com')],
        unknown: [inv.extend('nope', 10), inv.release('nope'), inv.commit('nope')],
        bad: [0, -5, 1.5, NaN].map((ms) => attempt(() => inv.extend('act', ms))),
        active: inv.extend('act', 10),
      };
    },
  },
  {
    name: 'keeps a hold taking all its lines or none of them',
    run: async ({ load }) => {
      const { inv } = await make(load);
      const miss = inv.hold('h1', lines(['A', 3], ['B', 5]));
      const out = { miss, held: [state(inv, 'A'), state(inv, 'B')] };
      out.after = inv.hold('h2', lines(['A', 5], ['B', 2])).ok;
      return out;
    },
  },
  {
    name: 'lines with the same sku are added up before the stock is checked',
    run: async ({ load }) => {
      const { inv } = await make(load);
      const miss = inv.hold('h1', lines(['A', 3], ['A', 3]));
      const ok = inv.hold('h2', lines(['A', 2], ['B', 1], ['A', 3]));
      return { miss, ok: [ok.ok, ok.hold?.lines], held: state(inv, 'A') };
    },
  },
  {
    name: 'every short line is reported, sorted by sku',
    run: async ({ load }) => {
      const { inv } = await make(load, {}, { A: 1, B: 1, C: 5, D: 9 });
      return inv.hold('h1', lines(['C', 9], ['D', 1], ['B', 2], ['A', 2]));
    },
  },
  {
    name: 'the same id with the same lines is a replay that reserves nothing twice',
    run: async ({ load }) => {
      const { inv, clock } = await make(load);
      const first = inv.hold('h1', lines(['A', 3], ['B', 1]));
      clock.set(500);
      const again = inv.hold('h1', lines(['B', 1], ['A', 2], ['A', 1]));
      const out = { first: first.replay, again: [again.ok, again.replay, again.hold.expiresAt, again.hold.lines], held: [state(inv, 'A'), state(inv, 'B')] };
      clock.set(2000);
      out.afterExpiry = inv.hold('h1', lines(['A', 3], ['B', 1])).replay;
      return out;
    },
  },
  {
    name: 'the same id with other lines or other quantities is a conflict',
    run: async ({ load }) => {
      const { inv } = await make(load);
      inv.hold('h1', lines(['A', 3]));
      return [lines(['A', 2]), lines(['A', 3], ['B', 1]), lines(['B', 3]), lines(['A', 4])].map((l) => attempt(() => inv.hold('h1', l)));
    },
  },
  {
    name: 'a committed id is taken for good, a released or an expired id can be used again',
    run: async ({ load }) => {
      const { inv, clock } = await make(load);
      inv.hold('c', lines(['A', 1]));
      inv.commit('c');
      inv.hold('r', lines(['A', 1]));
      inv.release('r');
      inv.hold('e', lines(['A', 1]));
      clock.set(2000);
      return {
        committed: attempt(() => inv.hold('c', lines(['A', 1]))),
        released: (({ ok, replay }) => [ok, replay])(inv.hold('r', lines(['A', 2]))),
        expired: (({ ok, replay }) => [ok, replay])(inv.hold('e', lines(['B', 1]))),
        snap: [state(inv, 'A'), state(inv, 'B')],
      };
    },
  },
  {
    name: 'keeps release giving the stock back once',
    run: async ({ load }) => {
      const { inv } = await make(load);
      inv.hold('h1', lines(['A', 4]));
      const out = [state(inv, 'A'), inv.release('h1'), state(inv, 'A'), inv.release('h1')];
      out.push(inv.hold('h2', lines(['A', 5])).ok);
      return out;
    },
  },
  {
    name: 'keeps commit moving stock off the shelf and into the ledger',
    run: async ({ load }) => {
      const { inv, clock } = await make(load);
      inv.hold('h1', lines(['A', 3], ['B', 1]));
      clock.set(300);
      const out = { commit: inv.commit('h1'), twice: inv.commit('h1'), a: state(inv, 'A'), b: state(inv, 'B') };
      out.ledger = inv.ledger().map((e) => [e.type, e.sku, e.qty, e.at]);
      return out;
    },
  },
  {
    name: 'adjust cannot take the shelf below the active holds, and expired holds do not count',
    run: async ({ load }) => {
      const { inv, clock } = await make(load);
      inv.hold('h1', lines(['A', 4]));
      const out = { low: attempt(() => inv.adjust('A', -2, 'lost')) ?? 'ok', edge: attempt(() => inv.adjust('A', -1, 'lost')) ?? 'ok' };
      out.up = attempt(() => inv.adjust('A', 3, 'found')) ?? 'ok';
      out.bad = [0, 1.5, NaN].map((d) => attempt(() => inv.adjust('A', d, 'x')));
      out.unknown = attempt(() => inv.adjust('Z', 1, 'x'));
      clock.set(1000);
      out.expired = attempt(() => inv.adjust('A', -7, 'gone')) ?? 'ok';
      out.state = state(inv, 'A');
      return out;
    },
  },
  {
    name: 'safety stock is kept back from buyers and available is never negative',
    run: async ({ load }) => {
      const { inv } = await make(load, { safety: { A: 7, B: 1 } });
      return { a: state(inv, 'A'), b: state(inv, 'B'), missA: inv.hold('h1', lines(['A', 1])), okB: inv.hold('h2', lines(['B', 1])).ok, missB: inv.hold('h3', lines(['B', 1])).ok, c: state(inv, 'C') };
    },
  },
  {
    name: 'keeps bad input refused',
    run: async ({ load }) => {
      const { inv } = await make(load);
      return [
        attempt(() => inv.hold('x', [])),
        attempt(() => inv.hold('x', lines(['A', 0]))),
        attempt(() => inv.hold('x', lines(['A', 1.5]))),
        attempt(() => inv.hold('x', [{ sku: '', qty: 1 }])),
        attempt(() => inv.hold('x', lines(['Z', 1]))),
        attempt(() => inv.hold('x', lines(['A', 1]), { ttlMs: 0 })),
        attempt(() => inv.receive('A', -1)),
        attempt(() => inv.snapshot('Z')),
      ];
    },
  },
  {
    name: 'expiring lists the active holds that end within the time, soonest first and then by id',
    run: async ({ load }) => {
      const { inv, clock } = await make(load);
      inv.hold('h3', lines(['A', 1]), { ttlMs: 300 });
      inv.hold('h1', lines(['A', 1]), { ttlMs: 300 });
      inv.hold('h2', lines(['A', 1]), { ttlMs: 200 });
      inv.hold('h4', lines(['A', 1]), { ttlMs: 900 });
      inv.hold('h5', lines(['B', 1]), { ttlMs: 100 });
      inv.release('h5');
      const out = { at0: inv.expiring(300), wide: inv.expiring(10_000).map((e) => e.id), none: inv.expiring(100) };
      clock.set(200);
      out.at200 = inv.expiring(100);
      return out;
    },
  },
  {
    name: 'keeps the copies that the inventory hands out separate from its books',
    run: async ({ load }) => {
      const { inv } = await make(load);
      const first = inv.hold('h1', lines(['A', 2]));
      first.hold.lines[0].qty = 99;
      first.hold.state = 'weird';
      const replay = inv.hold('h1', lines(['A', 2]));
      const ledger = inv.ledger();
      ledger[0].qty = 1000;
      return { replay: [replay.ok, replay.hold.lines, replay.hold.state], onHand: inv.snapshot('A').onHand, ledger: inv.ledger()[0].qty };
    },
  },
  {
    name: 'a long scripted run keeps the books straight',
    run: async ({ load }) => {
      const { inv, clock } = await make(load, { holdTtlMs: 700, maxHoldMs: 2500, safety: { C: 2 } }, { A: 12, B: 6, C: 20 });
      let seed = 7;
      const rnd = (n) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
      };
      const skus = ['A', 'B', 'C'];
      const log = [];
      for (let step = 0; step < 160; step += 1) {
        const id = `h${rnd(7)}`;
        const op = rnd(10);
        if (op < 4) {
          const count = 1 + rnd(3);
          const want = Array.from({ length: count }, () => ({ sku: skus[rnd(3)], qty: 1 + rnd(4) }));
          const r = attempt(() => inv.hold(id, want, rnd(3) === 0 ? { ttlMs: 100 + rnd(2000) } : {}));
          log.push(typeof r === 'string' ? r : r.ok ? (r.replay ? 'replay' : 'held') : `short${r.short.length}`);
        } else if (op === 4) log.push(inv.extend(id, 100 + rnd(900)));
        else if (op === 5) log.push(inv.release(id));
        else if (op === 6) log.push(inv.commit(id));
        else if (op === 7) log.push(attempt(() => inv.adjust(skus[rnd(3)], rnd(5) - 2 || 1, 'x')) ?? 'ok');
        else clock.advance(rnd(500));
        if (step % 20 === 19) log.push(skus.map((sku) => state(inv, sku)), inv.expiring(400).map((e) => `${e.id}@${e.expiresAt}`));
      }
      const sums = {};
      for (const e of inv.ledger()) sums[e.sku] = (sums[e.sku] ?? 0) + e.qty;
      return { log, onHand: skus.map((sku) => inv.snapshot(sku).onHand), sums };
    },
  },
];
