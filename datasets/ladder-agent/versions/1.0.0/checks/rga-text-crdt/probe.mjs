// Hidden probes for rga-text-crdt; expected.json holds the answers.
// Every probe drives replicas through src/index.mjs and returns plain values.
const lib = (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return error.constructor.name;
  }
};
const ins = (site, seq, clock, after, char) => ({ type: 'insert', site, seq, clock, after, char });
const del = (site, seq, clock, target) => ({ type: 'delete', site, seq, clock, target });
const prng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const permutations = (items) => {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
};
const idOf = (op) => `${op.site}@${op.seq}`;

/** Three or more replicas, random local edits and random, partial, repeated, shuffled delivery. */
function simulate(createReplica, seed, steps, sites) {
  const rnd = prng(seed);
  const pick = (n) => Math.floor(rnd() * n);
  const replicas = sites.map((site) => createReplica(site));
  const inbox = replicas.map(() => []);
  const alphabet = ['a', 'b', 'c', 'd', 'e', 'f', '😀', 'é'];
  const broadcast = (from, ops) => inbox.forEach((box, i) => i !== from && box.push(...ops));
  const deliver = (i, count) => {
    const batch = [];
    for (let k = 0; k < count && inbox[i].length; k += 1) batch.push(...inbox[i].splice(pick(inbox[i].length), 1));
    if (batch.length && rnd() < 0.3) batch.push(batch[pick(batch.length)]);
    replicas[i].receive(batch);
  };
  for (let step = 0; step < steps; step += 1) {
    const i = pick(replicas.length);
    const r = replicas[i];
    const roll = rnd();
    if (roll < 0.45) {
      const text = Array.from({ length: 1 + pick(3) }, () => alphabet[pick(alphabet.length)]).join('');
      broadcast(i, r.insertAt(pick(r.length + 1), text));
    } else if (roll < 0.65 && r.length > 0) {
      const index = pick(r.length);
      broadcast(i, r.deleteAt(index, 1 + pick(Math.min(3, r.length - index))));
    } else {
      deliver(i, 1 + pick(4));
    }
  }
  const midPending = replicas.map((r) => r.pendingCount());
  replicas.forEach((r, i) => {
    const rest = inbox[i].splice(0);
    for (let k = rest.length - 1; k > 0; k -= 1) {
      const j = pick(k + 1);
      [rest[k], rest[j]] = [rest[j], rest[k]];
    }
    r.receive(rest);
  });
  const texts = replicas.map((r) => r.text());
  const shapes = replicas.map((r) => JSON.stringify(r.elements()));
  return {
    same: texts.every((text) => text === texts[0]) && shapes.every((shape) => shape === shapes[0]),
    pending: replicas.map((r) => r.pendingCount()),
    midPending: midPending.some((n) => n > 0),
    length: replicas.map((r) => r.length),
    tombstones: replicas.map((r) => r.tombstoneCount()),
    text: texts[0],
    vectors: replicas.map((r) => r.stateVector()),
  };
}

export const probes = [
  {
    name: 'rg01 local typing, deleting and the shape of the operations',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const r = createReplica('ann');
      const a = r.insertAt(0, 'abc');
      const b = r.insertAt(1, 'XY');
      const c = r.deleteAt(0);
      const d = r.insertAt(r.length, '!');
      return { text: r.text(), length: r.length, ops: [a, b, c, d], vector: r.stateVector(), elements: r.elements(), site: r.site };
    },
  },
  {
    name: 'rg02 an insert goes after the visible element before it, not after a tombstone',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const r = createReplica('ann');
      r.insertAt(0, 'abcd');
      r.deleteAt(1, 2);
      const x = r.insertAt(1, 'X');
      const y = r.insertAt(0, 'Y');
      const z = r.insertAt(r.length, 'Z');
      return { text: r.text(), x, y, z, elements: r.elements().map((e) => `${e.id}${e.deleted ? '-' : '+'}${e.char}`) };
    },
  },
  {
    name: 'rg03 the clock follows applied operations and ignores waiting ones',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const ops = a.insertAt(0, 'abcde');
      const b = createReplica('bob');
      b.receive(ops.slice(0, 2));
      const first = b.insertAt(2, 'x')[0].clock;
      b.receive([ops[3]]);
      const second = b.insertAt(0, 'y')[0].clock;
      b.receive([ops[2]]);
      const third = b.insertAt(0, 'z')[0].clock;
      const c = createReplica('cat');
      c.receive([{ ...ops[4], clock: 40 }, ...ops.slice(0, 4)]);
      const fourth = c.insertAt(0, 'q')[0].clock;
      return { first, second, third, fourth, bobPending: b.pendingCount(), text: b.text() };
    },
  },
  {
    name: 'rg04 a text is a sequence of code points',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const r = createReplica('ann');
      const ops = r.insertAt(0, 'a😀b');
      const first = { length: r.length, text: r.text(), chars: ops.map((op) => op.char) };
      r.insertAt(2, 'X');
      const del1 = r.deleteAt(1);
      const second = { text: r.text(), length: r.length, target: del1[0].target };
      r.insertAt(r.length, '\ud83d');
      r.insertAt(0, '👨‍👩');
      const third = { length: r.length, text: r.text() };
      return { first, second, third, error: attempt(() => r.insertAt(r.length + 1, 'x')) };
    },
  },
  {
    name: 'rg05 deleteAt picks its targets first and reports them in order',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const r = createReplica('bob');
      r.insertAt(0, 'abcdefgh');
      const none = r.deleteAt(2, 0);
      const one = r.deleteAt(0);
      const range = r.deleteAt(1, 3);
      const rest = r.deleteAt(0, r.length);
      return { none, one, range, rest, text: r.text(), length: r.length, tombstones: r.tombstoneCount(), vector: r.stateVector(), empty: r.insertAt(0, ''), again: r.deleteAt(0, 0) };
    },
  },
  {
    name: 'rg06 bad arguments throw and change nothing',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const r = createReplica('ann');
      r.insertAt(0, 'ab');
      const out = {
        negative: attempt(() => r.insertAt(-1, 'x')),
        fraction: attempt(() => r.insertAt(0.5, 'x')),
        nan: attempt(() => r.insertAt(Number.NaN, 'x')),
        text: attempt(() => r.insertAt('1', 'x')),
        past: attempt(() => r.insertAt(3, 'x')),
        notString: attempt(() => r.insertAt(0, 5)),
        nullText: attempt(() => r.insertAt(0, null)),
        delNegative: attempt(() => r.deleteAt(-1)),
        delCount: attempt(() => r.deleteAt(0, -1)),
        delPast: attempt(() => r.deleteAt(1, 2)),
        delAt: attempt(() => r.deleteAt(2)),
        delFraction: attempt(() => r.deleteAt(0, 1.5)),
        delString: attempt(() => r.deleteAt('0')),
        site1: attempt(() => createReplica('')),
        site2: attempt(() => createReplica(5)),
        site3: attempt(() => createReplica('a@b')),
        site4: attempt(() => createReplica('é')),
        site5: attempt(() => createReplica('a b')),
        site6: attempt(() => createReplica()),
        siteOk: attempt(() => createReplica('A-z_9').site),
      };
      return { out, text: r.text(), vector: r.stateVector(), length: r.length };
    },
  },
  {
    name: 'rg07 inserts with equal clocks are ordered by site, greater site first',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const results = [];
      for (const [x, y] of [['ann', 'bob'], ['bob', 'ann'], ['Zed', 'abe'], ['a1', 'a10'], ['a', 'A'], ['x', 'x-']]) {
        const a = createReplica(x);
        const b = createReplica(y);
        const fromA = a.insertAt(0, 'A');
        const fromB = b.insertAt(0, 'B');
        a.receive(fromB);
        b.receive(fromA);
        results.push([a.text(), b.text()]);
      }
      return results;
    },
  },
  {
    name: 'rg08 the greater clock goes first whatever the site',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const b = createReplica('bob');
      b.receive(a.insertAt(0, 'xyz'));
      a.receive(b.insertAt(3, 'abcd'));
      const fromA = a.insertAt(1, 'A');
      const fromB = b.insertAt(1, 'B');
      const bobStamp = fromB[0].clock;
      const annStamp = fromA[0].clock;
      a.receive(fromB);
      b.receive(fromA);
      const c = createReplica('cat');
      const d = createReplica('dan');
      const base = c.insertAt(0, 'p');
      d.receive(base);
      const fromD = d.insertAt(1, 'D');
      c.insertAt(1, 'u');
      c.deleteAt(1);
      const fromC = c.insertAt(1, 'C');
      c.receive(fromD);
      d.receive(c.opsSince(d.stateVector()));
      return { a: a.text(), b: b.text(), annStamp, bobStamp, c: c.text(), d: d.text(), cClock: fromC[0].clock, dClock: fromD[0].clock };
    },
  },
  {
    name: 'rg09 concurrent typed words never interleave',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const out = [];
      for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [0, 2, 1]]) {
        const sites = ['ann', 'bob', 'cat'].map((s) => createReplica(s));
        const words = ['abc', 'xyz', '123'];
        const made = sites.map((r, i) => r.insertAt(0, words[i]));
        for (const i of order) sites.forEach((r, j) => j !== i && r.receive(made[i]));
        out.push(sites.map((r) => r.text()));
      }
      const a = createReplica('ann');
      const b = createReplica('bob');
      a.insertAt(0, 'start-end');
      b.receive(a.opsSince({}));
      const m1 = a.insertAt(6, 'MIDDLE');
      const m2 = b.insertAt(6, 'other');
      const e1 = a.insertAt(0, '<');
      a.receive(m2);
      b.receive([...m1, ...e1]);
      out.push([a.text(), b.text()]);
      return out;
    },
  },
  {
    name: 'rg10 the whole subtree of a child moves with it, in every delivery order',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const ops = [
        ins('ann', 1, 1, null, 'p'),
        ins('cat', 1, 3, 'ann@1', 's'),
        ins('cat', 2, 7, 'cat@1', 'd'),
        ins('dan', 1, 6, 'ann@1', 'S'),
        ins('dan', 2, 8, 'dan@1', 'D'),
        ins('bob', 1, 5, 'ann@1', 'e'),
        ins('eve', 1, 4, 'ann@1', 'f'),
      ];
      const texts = new Set();
      const shapes = new Set();
      let count = 0;
      for (const order of permutations(ops)) {
        const r = createReplica('zed');
        r.receive(order);
        texts.add(r.text());
        shapes.add(r.elements().map((e) => e.id).join(','));
        count += 1;
      }
      const one = createReplica('zed');
      for (const op of [...ops].reverse()) one.receive([op]);
      return { texts: [...texts], shapes: [...shapes], count, reverse: one.text(), pending: one.pendingCount() };
    },
  },
  {
    name: 'rg11 siblings with equal clocks are ordered by site in every delivery order',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const ops = [ins('bob', 1, 2, 'ann@1', 'b'), ins('amy', 1, 2, 'ann@1', 'm'), ins('cat', 1, 2, 'ann@1', 'c'), ins('Zed', 1, 2, 'ann@1', 'z'), ins('zed', 1, 2, 'ann@1', 'Z'), ins('cat', 2, 3, 'cat@1', '!')];
      const texts = new Set();
      for (const order of permutations(ops)) {
        const r = createReplica('mia');
        r.receive([ins('ann', 1, 1, null, 'p')]);
        r.receive(order);
        texts.add(r.text());
      }
      return [...texts];
    },
  },
  {
    name: 'rg12 an insert after a deleted element lands after its tombstone',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const b = createReplica('bob');
      b.receive(a.insertAt(0, 'abc'));
      const gone = a.deleteAt(1);
      const added = b.insertAt(2, 'X');
      a.receive(added);
      b.receive(gone);
      const c = createReplica('cat');
      c.receive([...a.opsSince({})].reverse());
      return { a: a.text(), b: b.text(), c: c.text(), elements: a.elements().map((e) => `${e.id}${e.deleted ? '-' : '+'}${e.char}`), same: JSON.stringify(a.elements()) === JSON.stringify(b.elements()) };
    },
  },
  {
    name: 'rg13 deleting an element twice changes nothing',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const b = createReplica('bob');
      b.receive(a.insertAt(0, 'hello'));
      const da = a.deleteAt(1, 2);
      const db = b.deleteAt(2, 2);
      a.receive(db);
      b.receive(da);
      const again = a.receive(db);
      return { a: a.text(), b: b.text(), tombstones: [a.tombstoneCount(), b.tombstoneCount()], again, vector: a.stateVector(), same: JSON.stringify(a.elements()) === JSON.stringify(b.elements()) };
    },
  },
  {
    name: 'rg14 a delete and an insert at the same place',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const out = [];
      for (const flip of [false, true]) {
        const a = createReplica('ann');
        const b = createReplica('bob');
        b.receive(a.insertAt(0, 'abc'));
        const d = a.deleteAt(0);
        const i = b.insertAt(0, 'Z');
        const j = b.insertAt(3, 'Y');
        if (flip) {
          b.receive(d);
          a.receive(j);
          a.receive(i);
        } else {
          a.receive([...i, ...j]);
          b.receive(d);
        }
        out.push([a.text(), b.text(), a.elements().map((e) => e.id)]);
      }
      return out;
    },
  },
  {
    name: 'rg15 a delete that arrives before the insert it names waits for it',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const b = createReplica('bob');
      const c = createReplica('cat');
      const made = a.insertAt(0, 'xy');
      b.receive(made);
      const gone = b.deleteAt(0);
      const first = c.receive(gone);
      const pendingMid = c.pendingCount();
      const second = c.receive([made[1]]);
      const third = c.receive([made[0]]);
      return { first, pendingMid, second, third, text: c.text(), pending: c.pendingCount(), vector: c.stateVector(), tombstones: c.tombstoneCount() };
    },
  },
  {
    name: 'rg16 operations of one site are applied in sequence, gaps wait',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const [o1, o2, o3, o4] = a.insertAt(0, 'abcd');
      const b = createReplica('bob');
      const r1 = b.receive([o3]);
      const r2 = b.receive([o4, o1]);
      const text1 = b.text();
      const vector1 = b.stateVector();
      const pending1 = b.pendingCount();
      const r3 = b.receive([o2]);
      return { r1, r2, text1, vector1, pending1, r3: r3.map(idOf), text: b.text(), pending: b.pendingCount(), vector: b.stateVector() };
    },
  },
  {
    name: 'rg17 duplicates are ignored, waiting or applied',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const [o1, o2, o3] = a.insertAt(0, 'abc');
      const b = createReplica('bob');
      const r1 = b.receive([o3, o3, { ...o3 }]);
      const p1 = b.pendingCount();
      const r2 = b.receive([o1, o1]);
      const r3 = b.receive([o3, o2, o2]);
      const r4 = b.receive([o1, o2, o3]);
      return { r1, p1, r2: r2.map(idOf), r3: r3.map(idOf), r4, text: b.text(), pending: b.pendingCount(), log: b.opsSince({}).length };
    },
  },
  {
    name: 'rg18 of the ready operations, the one received first is applied first',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a1 = ins('ann', 1, 1, null, 'a');
      const b1 = ins('bob', 1, 1, null, 'b');
      const b2 = ins('bob', 2, 2, 'bob@1', 'B');
      const c1 = ins('cat', 1, 2, 'ann@1', 'c');
      const d1 = del('dan', 1, 3, 'bob@1');
      const out = [];
      for (const delivery of [[c1, b2, b1, a1], [b2, c1, a1, b1], [d1, c1, b2, b1, a1], [a1, d1, b2, c1, b1]]) {
        const r = createReplica('zed');
        const applied = r.receive(delivery).map(idOf);
        out.push({ applied, text: r.text(), log: r.opsSince({}).map(idOf), pending: r.pendingCount() });
      }
      const r = createReplica('zed');
      const steps = [r.receive([c1, b2]).map(idOf), r.receive([d1]).map(idOf), r.receive([b1]).map(idOf), r.receive([a1]).map(idOf)];
      out.push({ steps, text: r.text(), tombstones: r.tombstoneCount() });
      return out;
    },
  },
  {
    name: 'rg19 receive checks every operation before it applies any',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const good = ins('ann', 1, 1, null, 'a');
      const cases = {
        notArray: 'x',
        undef: undefined,
        nullOp: [good, null],
        string: [good, 'op'],
        arrayOp: [good, []],
        instance: [good, new (class Op {})()],
        type: [good, { ...good, type: 'move' }],
        site: [good, { ...good, site: 'a b' }],
        siteEmpty: [good, { ...good, site: '' }],
        seq0: [good, ins('ann', 0, 1, null, 'a')],
        seqFraction: [good, ins('ann', 1.5, 1, null, 'a')],
        seqString: [good, ins('ann', '2', 1, null, 'a')],
        clock0: [good, ins('ann', 2, 0, null, 'a')],
        clockNaN: [good, ins('ann', 2, Number.NaN, null, 'a')],
        charEmpty: [good, ins('ann', 2, 2, null, '')],
        charTwo: [good, ins('ann', 2, 2, null, 'ab')],
        charNumber: [good, ins('ann', 2, 2, null, 1)],
        afterUndefined: [good, { ...good, seq: 2, after: undefined }],
        afterBad: [good, ins('ann', 2, 2, 'ann', 'b')],
        afterZero: [good, ins('ann', 2, 2, 'ann@0', 'b')],
        afterLeadingZero: [good, ins('ann', 2, 2, 'ann@01', 'b')],
        afterSite: [good, ins('ann', 2, 2, 'a b@1', 'b')],
        targetNull: [good, del('ann', 2, 2, null)],
        targetBad: [good, del('ann', 2, 2, 'x')],
        targetMissing: [good, { type: 'delete', site: 'ann', seq: 2, clock: 2 }],
      };
      const out = {};
      for (const [name, ops] of Object.entries(cases)) {
        const r = createReplica('bob');
        out[name] = [attempt(() => r.receive(ops)), r.text(), r.pendingCount(), Object.keys(r.stateVector()).length];
      }
      const accepted = createReplica('bob');
      const applied = accepted.receive([{ ...good, extra: 1 }, ins('ann', 2, 2, 'ann@1', '😀'), ins('ann', 3, 3, 'ann@2', 'é')]);
      return { out, applied, text: accepted.text(), keys: applied.map((op) => Object.keys(op).sort().join(',')) };
    },
  },
  {
    name: 'rg20 nothing is shared with the caller',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const made = a.insertAt(0, 'ab');
      made[0].char = 'Z';
      made[1].after = 'ann@9';
      const log = a.opsSince({});
      log[0].seq = 99;
      log.pop();
      const b = createReplica('bob');
      const incoming = [ins('ann', 1, 1, null, 'x'), ins('ann', 3, 3, 'ann@2', 'z')];
      const applied = b.receive(incoming);
      incoming[0].char = 'Q';
      incoming[1].char = 'Q';
      applied[0].char = 'R';
      const saved = b.serialize();
      saved.ops[0].char = 'S';
      saved.pending[0].char = 'S';
      const vector = b.stateVector();
      vector.ann = 50;
      b.receive([ins('ann', 2, 2, 'ann@1', 'y')]);
      return { a: a.text(), aLog: a.opsSince({}).map((op) => `${op.seq}${op.char}`), b: b.text(), bLog: b.opsSince({}).map((op) => `${op.seq}${op.char}`), vector: b.stateVector(), elements: a.elements() };
    },
  },
  {
    name: 'rg21 state vectors and the operations since a vector',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const sites = ['ann', 'constructor', '__proto__', 'toString', 'hasOwnProperty'];
      const reps = sites.map((s) => createReplica(s));
      reps.forEach((r, i) => r.insertAt(0, `${i}${i}`));
      const first = reps[0];
      for (const r of reps.slice(1)) first.receive(r.opsSince(first.stateVector()));
      const other = createReplica('zed');
      const afterOne = other.receive(first.opsSince({}).slice(0, 3));
      const vec = other.stateVector();
      const missing = first.opsSince(vec).map(idOf);
      const hostile = first.opsSince(JSON.parse('{"__proto__":1,"constructor":0,"ann":1}')).map(idOf);
      return {
        vector: first.stateVector(),
        since: first.opsSince({}).map(idOf),
        missing,
        hostile,
        defaulted: first.opsSince().length,
        none: first.opsSince(first.stateVector()),
        afterOne: afterOne.length,
        text: first.text(),
      };
    },
  },
  {
    name: 'rg22 merge brings replicas together',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const reps = ['ann', 'bob', 'cat'].map((s) => createReplica(s));
      reps[0].insertAt(0, 'one ');
      reps[1].insertAt(0, 'two ');
      reps[2].insertAt(0, 'three ');
      reps[0].deleteAt(1, 2);
      const ring = [];
      for (let round = 0; round < 2; round += 1) {
        for (let i = 0; i < 3; i += 1) ring.push(reps[i].merge(reps[(i + 1) % 3]).map(idOf));
      }
      const self = reps[0].merge(reps[0]);
      return { ring, texts: reps.map((r) => r.text()), self, errors: [attempt(() => reps[0].merge({})), attempt(() => reps[0].merge(null)), attempt(() => reps[0].merge(reps[0].serialize()))], vectors: reps.map((r) => r.stateVector()) };
    },
  },
  {
    name: 'rg23 tombstones stay in the sequence and keep the order of concurrent edits',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const b = createReplica('bob');
      const c = createReplica('cat');
      b.receive(a.insertAt(0, 'abcdef'));
      c.receive(a.opsSince({}));
      const d1 = a.deleteAt(2, 2);
      const i1 = b.insertAt(3, '--');
      const i2 = c.insertAt(2, '++');
      const d2 = c.deleteAt(0, 1);
      for (const [r, ops] of [[a, [...i1, ...i2, ...d2]], [b, [...d1, ...i2, ...d2]], [c, [...d1, ...i1]]]) r.receive(ops);
      const show = (r) => r.elements().map((e) => `${e.id}${e.deleted ? '-' : '+'}${e.char}`);
      return { texts: [a.text(), b.text(), c.text()], shapes: [show(a), show(b), show(c)], tombstones: [a.tombstoneCount(), b.tombstoneCount(), c.tombstoneCount()] };
    },
  },
  {
    name: 'rg24 a saved replica comes back the same and goes on',
    run: async ({ load }) => {
      const { createReplica, restoreReplica } = await lib(load);
      const a = createReplica('ann');
      const b = createReplica('bob');
      const made = a.insertAt(0, 'hello');
      b.receive(made.slice(0, 2));
      b.receive([made[4], made[3]]);
      b.insertAt(1, 'B');
      b.deleteAt(0);
      const saved = JSON.parse(JSON.stringify(b.serialize()));
      const r = restoreReplica(saved);
      const sameState = JSON.stringify([r.text(), r.elements(), r.stateVector(), r.pendingCount(), r.serialize()]) === JSON.stringify([b.text(), b.elements(), b.stateVector(), b.pendingCount(), b.serialize()]);
      const next = r.insertAt(r.length, '!');
      const nextB = b.insertAt(b.length, '!');
      const late = r.receive([made[2]]).map(idOf);
      return { keys: Object.keys(saved).sort(), sameState, next, nextB, late, text: r.text(), pending: r.pendingCount(), pendingOps: saved.pending.map(idOf), opsCount: saved.ops.length, vector: r.stateVector() };
    },
  },
  {
    name: 'rg25 restoreReplica refuses bad data',
    run: async ({ load }) => {
      const { createReplica, restoreReplica } = await lib(load);
      const good = createReplica('ann');
      good.insertAt(0, 'ab');
      const data = good.serialize();
      return {
        nothing: attempt(() => restoreReplica()),
        nul: attempt(() => restoreReplica(null)),
        site: attempt(() => restoreReplica({ ...data, site: 'a b' })),
        noSite: attempt(() => restoreReplica({ ops: [], pending: [] })),
        noOps: attempt(() => restoreReplica({ site: 'ann', pending: [] })),
        noPending: attempt(() => restoreReplica({ site: 'ann', ops: [] })),
        opsNotArray: attempt(() => restoreReplica({ site: 'ann', ops: {}, pending: [] })),
        badOp: attempt(() => restoreReplica({ site: 'ann', ops: [{ type: 'insert' }], pending: [] })),
        ok: attempt(() => restoreReplica({ site: 'zed', ops: data.ops, pending: [] }).text()),
        empty: attempt(() => restoreReplica({ site: 'zed', ops: [], pending: [] }).length),
      };
    },
  },
  {
    name: 'rg26 random editing of three replicas converges (seeds 1 to 3)',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      return [1, 2, 3].map((seed) => simulate(createReplica, seed, 260, ['ann', 'bob', 'cat']));
    },
  },
  {
    name: 'rg27 random editing of five replicas converges (seeds 4 to 6)',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      return [4, 5, 6].map((seed) => simulate(createReplica, seed, 500, ['a', 'b', 'c', 'd', 'e']));
    },
  },
  {
    name: 'rg28 random editing with sites that sort in odd ways',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      return [7, 8].map((seed) => simulate(createReplica, seed, 400, ['Zed', 'a', 'A-1', 'a-1', '_', '9']));
    },
  },
  {
    name: 'rg29 a chain of operations that each wait for the one before it',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const b = createReplica('bob');
      const c = createReplica('cat');
      const o = a.insertAt(0, 'abc');
      b.receive(o);
      const p = b.insertAt(3, 'def');
      c.receive(o);
      c.receive(p);
      const q = c.insertAt(0, 'xyz');
      const r = c.deleteAt(1, 2);
      const fresh = createReplica('dan');
      const all = [...q, ...r, ...p, ...o];
      const applied = fresh.receive(all).map(idOf);
      const sliced = createReplica('eve');
      const steps = all.map((op) => sliced.receive([op]).length);
      return { applied, text: fresh.text(), pending: fresh.pendingCount(), steps, same: sliced.text() === fresh.text(), vector: fresh.stateVector() };
    },
  },
  {
    name: 'rg30 an operation that waits on its sequence and on an element at once',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const r = createReplica('zed');
      const a1 = ins('ann', 1, 1, null, 'a');
      const b1 = ins('bob', 1, 2, 'ann@1', 'b');
      const b2 = ins('bob', 2, 3, 'bob@1', 'B');
      const c1 = ins('cat', 1, 4, 'bob@2', 'c');
      const c2 = del('cat', 2, 5, 'ann@1');
      const first = r.receive([c2, c1]);
      const mid = r.pendingCount();
      const second = r.receive([b2]);
      const third = r.receive([b1]);
      const fourth = r.receive([a1]).map(idOf);
      return { first, mid, second, third, fourth, text: r.text(), pending: r.pendingCount(), tombstones: r.tombstoneCount() };
    },
  },
  {
    name: 'rg31 an operation whose element never arrives stays waiting',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const r = createReplica('zed');
      const ops = [ins('bob', 1, 1, 'ann@1', 'x'), ins('bob', 2, 2, 'bob@1', 'y'), del('cat', 1, 1, 'ann@7'), ins('dan', 1, 1, null, 'd')];
      const applied = r.receive(ops).map(idOf);
      const saved = r.serialize();
      return { applied, text: r.text(), pending: r.pendingCount(), vector: r.stateVector(), waiting: saved.pending.map(idOf), restored: (await lib(load)).restoreReplica(JSON.parse(JSON.stringify(saved))).pendingCount() };
    },
  },
  {
    name: 'rg32 a replica that received operations numbers its own after them',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const a = createReplica('ann');
      const b = createReplica('bob');
      a.insertAt(0, 'xyz');
      b.receive(a.opsSince({}));
      const mine = b.insertAt(1, 'B');
      a.receive(mine);
      const next = a.insertAt(0, 'Q');
      const del1 = a.deleteAt(0);
      const back = b.receive([...next, ...del1]);
      const c = createReplica('ann');
      const clash = c.receive([ins('ann', 1, 1, null, 'z')]);
      const afterClash = c.insertAt(0, 'k');
      return { mine, next, del1, back, text: [a.text(), b.text()], clash, afterClash };
    },
  },
  {
    name: 'rg33 ten thousand local inserts, three thousand in the middle, a thousand deletes',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const t0 = cpuMs();
      const slow = () => cpuMs() - t0 > 3500;
      const r = createReplica('ann');
      for (let i = 0; i < 10000; i += 1) {
        r.insertAt(r.length, String.fromCharCode(97 + (i % 26)));
        if (i % 250 === 0 && slow()) return { slow: true };
      }
      const rnd = prng(11);
      for (let i = 0; i < 3000; i += 1) {
        r.insertAt(Math.floor(rnd() * (r.length + 1)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i % 26]);
        if (i % 250 === 0 && slow()) return { slow: true };
      }
      for (let i = 0; i < 1000; i += 1) {
        r.deleteAt(Math.floor(rnd() * r.length));
        if (i % 250 === 0 && slow()) return { slow: true };
      }
      const text = r.text();
      let hash = 0;
      for (let i = 0; i < text.length; i += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
      return { fast: !slow(), length: r.length, hash, tombstones: r.tombstoneCount(), ops: r.opsSince({}).length, vector: r.stateVector() };
    },
  },
  {
    name: 'rg34 five thousand operations delivered one at a time in reverse',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const t0 = cpuMs();
      const slow = () => cpuMs() - t0 > 3500;
      const a = createReplica('ann');
      const rnd = prng(5);
      const ops = [];
      for (let i = 0; i < 4000; i += 1) ops.push(...a.insertAt(Math.floor(rnd() * (a.length + 1)), String.fromCharCode(97 + (i % 26))));
      for (let i = 0; i < 1000; i += 1) ops.push(...a.deleteAt(Math.floor(rnd() * a.length)));
      const b = createReplica('bob');
      const applied = [];
      for (let i = ops.length - 1; i >= 0; i -= 1) {
        applied.push(b.receive([ops[i]]).length);
        if (i % 100 === 0 && slow()) return { slow: true };
      }
      return { fast: !slow(), same: b.text() === a.text(), pending: b.pendingCount(), lastBatch: applied[applied.length - 1], others: applied.slice(0, -1).every((n) => n === 0), log: b.opsSince({}).every((op, i) => op.seq === i + 1) };
    },
  },
  {
    name: 'rg35 three replicas typing at the start and the end thousands of times',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const t0 = cpuMs();
      const reps = ['ann', 'bob', 'cat'].map((s) => createReplica(s));
      const made = [];
      for (const [i, r] of reps.entries()) {
        const ops = [];
        for (let k = 0; k < 2500; k += 1) {
          ops.push(...r.insertAt(k % 7 === 0 ? 0 : r.length, `${i}`));
          if (k % 250 === 0 && cpuMs() - t0 > 3500) return { slow: true };
        }
        made.push(ops);
      }
      reps.forEach((r, i) => made.forEach((ops, j) => j !== i && r.receive(ops)));
      return { fast: cpuMs() - t0 < 3500, texts: reps.map((r) => r.text().length), same: reps[0].text() === reps[1].text() && reps[1].text() === reps[2].text(), head: reps[0].text().slice(0, 60), pending: reps.map((r) => r.pendingCount()) };
    },
  },
  {
    name: 'rg36 deleting a very long range in one call',
    run: async ({ load }) => {
      const { createReplica } = await lib(load);
      const t0 = cpuMs();
      const a = createReplica('ann');
      a.insertAt(0, 'x'.repeat(8000));
      const gone = a.deleteAt(100, 7000);
      const b = createReplica('bob');
      const applied = b.receive(a.opsSince({})).length;
      return { fast: cpuMs() - t0 < 3500, length: a.length, gone: gone.length, first: gone[0], last: gone[gone.length - 1], tombstones: a.tombstoneCount(), applied, bLength: b.length, vector: b.stateVector() };
    },
  },
];
