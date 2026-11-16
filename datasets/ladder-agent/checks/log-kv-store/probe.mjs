// Hidden probes for ladder-agent-log-kv-store; expected.json holds the answers.
// The probes bring their own disk and their own encoder, so nothing here depends on the starter's helpers.
const lib = (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const be32 = (n) => Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const be16 = (n) => Buffer.from([n >>> 8, n & 255]);
const cat = (...parts) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : p)));
const rec = (body) => cat(be32(crc(body)), be32(body.length), body);
const bPut = (k, v) => cat(Buffer.from([1]), be16(Buffer.byteLength(k)), k, v);
const bDel = (k) => cat(Buffer.from([2]), be16(Buffer.byteLength(k)), k);
const bBatch = (ops) => cat(Buffer.from([3]), be16(ops.length), ...ops.map((o) => (o.op === 'put' ? cat(Buffer.from([1]), be16(Buffer.byteLength(o.key)), o.key, be32(Buffer.byteLength(o.value)), o.value) : cat(Buffer.from([2]), be16(Buffer.byteLength(o.key)), o.key))));
const bSup = (n) => cat(Buffer.from([4]), be32(n));
const P = (k, v) => rec(bPut(k, v));
const D = (k) => rec(bDel(k));
const B = (ops) => rec(bBatch(ops));
const S = (n) => rec(bSup(n));
const seg = (n) => `seg-${String(n).padStart(6, '0')}.log`;
const hex = (b) => Buffer.from(b).toString('hex');

class Disk {
  constructor(files = {}) {
    this.files = new Map();
    this.ops = [];
    this.reads = [];
    this.mutations = 0;
    this.crashAfter = Infinity;
    this.tear = null;
    for (const [name, bytes] of Object.entries(files)) this.files.set(name, [Buffer.from(bytes)]);
  }

  bytes(name) {
    const chunks = this.files.get(name);
    return chunks === undefined ? undefined : Buffer.concat(chunks);
  }

  gate(kind, bytes, name) {
    this.mutations += 1;
    if (this.mutations <= this.crashAfter) return;
    if (this.tear !== null && (kind === 'append' || kind === 'write')) {
      const part = Buffer.from(bytes).subarray(0, this.tear);
      if (kind === 'append') this.files.set(name, [...(this.files.get(name) ?? []), part]);
      else this.files.set(name, [part]);
    }
    throw new Error('crash');
  }

  read(name) {
    this.reads.push(name);
    const b = this.bytes(name);
    return b === undefined ? undefined : new Uint8Array(b);
  }

  append(name, bytes) {
    this.gate('append', bytes, name);
    this.ops.push(`append ${name} ${bytes.length}`);
    const chunks = this.files.get(name);
    if (chunks === undefined) this.files.set(name, [Buffer.from(bytes)]);
    else chunks.push(Buffer.from(bytes)); // no copy of the chunk list: the probe's own disk must stay cheap
  }

  write(name, bytes) {
    this.gate('write', bytes, name);
    this.ops.push(`write ${name} ${bytes.length}`);
    this.files.set(name, [Buffer.from(bytes)]);
  }

  rename(from, to) {
    this.gate('rename', null, from);
    this.ops.push(`rename ${from} ${to}`);
    if (!this.files.has(from)) throw new Error(`no file ${from}`);
    this.files.set(to, this.files.get(from));
    this.files.delete(from);
  }

  remove(name) {
    this.gate('remove', null, name);
    this.ops.push(`remove ${name}`);
    this.files.delete(name);
  }

  list() {
    return [...this.files.keys()].reverse();
  }

  /** A new disk with the files as they are now (a restart after a crash). */
  survivors() {
    return new Disk(Object.fromEntries([...this.files.keys()].map((name) => [name, this.bytes(name)])));
  }

  names() {
    return [...this.files.keys()].sort();
  }

  sizes() {
    return Object.fromEntries(this.names().map((name) => [name, this.bytes(name).length]));
  }
}

const open = async (load, disk, options) => (await lib(load)).openStore(disk, options);
const errorOf = (fn) => {
  try {
    fn();
    return 'no error';
  } catch (error) {
    return { name: error.constructor.name, ...(error.reason !== undefined ? { reason: error.reason, segment: error.segment ?? null, offset: error.offset ?? null } : {}) };
  }
};
const opened = async (load, files, options) => {
  const disk = new Disk(files);
  try {
    const store = await open(load, disk, options);
    return { disk, store, entries: store.entries() };
  } catch (error) {
    return { disk, error: errorOf(() => { throw error; }) };
  }
};
const entriesOf = async (load, files, options) => {
  const r = await opened(load, files, options);
  return r.error ?? r.entries;
};

export const probes = [
  {
    name: 'omitted and undefined segment limits use the exact published default',
    run: async ({ load }) => {
      const result = [];
      for (const options of [undefined, { maxSegmentBytes: undefined }]) {
        const disk = new Disk();
        const store = await open(load, disk, options);
        const states = [];
        const remember = () => { const stats = store.stats(); states.push([stats.segments, stats.bytes, stats.active]); };
        store.put('a', 'x'.repeat(100));
        remember();
        store.put('b', 'x'.repeat(1048576 - 124));
        remember();
        store.put('c', '');
        remember();
        result.push(states);
      }
      return result;
    },
  },
  {
    name: 'keeps the exports and the checksum',
    run: async ({ load }) => {
      const mod = await lib(load);
      return { exports: Object.keys(mod).sort(), crc: mod.crc32(Buffer.from('123456789')), empty: mod.crc32(new Uint8Array(0)) };
    },
  },
  {
    name: 'keys come out sorted by code unit with an optional prefix',
    run: async ({ load }) => {
      const store = await open(load, new Disk());
      for (const key of ['b', 'B', 'a', 'ab', 'é', 'z', 'a b', '10', '9', 'a\u{1F600}', 'a￿', '_']) store.put(key, `v-${key}`);
      return { all: store.keys(), a: store.keys('a'), none: store.keys('zzz'), empty: store.keys(''), entries: store.entries('a').length, first: store.entries()[0] };
    },
  },
  {
    name: 'get has and delete follow the data',
    run: async ({ load }) => {
      const store = await open(load, new Disk());
      store.put('k', 'one');
      const first = [store.get('k'), store.has('k'), store.get('nope'), store.has('nope')];
      store.put('k', 'two');
      store.put('e', '');
      const second = [store.get('k'), store.get('e'), store.has('e')];
      const del = [store.delete('k'), store.delete('k'), store.has('k'), store.get('k'), store.delete('never')];
      store.put('k', 'three');
      return { first, second, del, again: store.get('k'), keys: store.keys() };
    },
  },
  {
    name: 'a store reads and writes nothing when it opens clean and get has keys entries and stats never touch the disk',
    run: async ({ load }) => {
      const disk = new Disk({ [seg(1)]: cat(P('a', '1'), P('b', '2')), [seg(2)]: P('c', '3'), 'note.txt': 'x' });
      const store = await open(load, disk, { maxSegmentBytes: 100 });
      const afterOpen = { reads: [...disk.reads].sort(), ops: [...disk.ops] };
      disk.reads.length = 0;
      store.get('a');
      store.has('b');
      store.keys();
      store.entries('c');
      store.stats();
      return { afterOpen, afterCalls: disk.reads.length, ops: disk.ops.length };
    },
  },
  {
    name: 'an empty disk opens without a file and reports empty stats',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk);
      return { stats: store.stats(), keys: store.keys(), ops: disk.ops, files: disk.names(), compact: store.compact(), after: disk.ops };
    },
  },
  {
    name: 'a put appends one record in the exact format',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk);
      store.put('key', 'välue');
      store.put('é', '');
      store.put('日本', '🙂');
      return { ops: disk.ops, same: hex(disk.bytes(seg(1))) === hex(cat(P('key', 'välue'), P('é', ''), P('日本', '🙂'))), size: store.stats().bytes };
    },
  },
  {
    name: 'a delete of an existing key appends one delete record and a delete of a missing key writes nothing',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk);
      store.put('k', 'v');
      disk.ops.length = 0;
      const results = [store.delete('k'), store.delete('k'), store.delete('other')];
      return { results, ops: disk.ops, same: hex(disk.bytes(seg(1))) === hex(cat(P('k', 'v'), D('k'))) };
    },
  },
  {
    name: 'a delete checks its key like a put even when the key is missing',
    run: async ({ load }) => {
      const store = await open(load, new Disk());
      return [errorOf(() => store.delete('')), errorOf(() => store.delete(5)), errorOf(() => store.delete('x'.repeat(256))), errorOf(() => store.delete('\ud800')), errorOf(() => store.delete('fine'))];
    },
  },
  {
    name: 'a batch is one record with every operation and applies in order',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk);
      store.put('old', '1');
      disk.ops.length = 0;
      const ops = [{ op: 'put', key: 'x', value: '1' }, { op: 'delete', key: 'old' }, { op: 'delete', key: 'ghost' }, { op: 'put', key: 'x', value: '2' }, { op: 'put', key: 'y', value: '' }, { op: 'delete', key: 'y' }, { op: 'put', key: 'y', value: 'ünï' }];
      store.batch(ops);
      const reopened = await open(load, disk.survivors());
      return { ops: disk.ops, same: hex(disk.bytes(seg(1))) === hex(cat(P('old', '1'), B(ops))), entries: store.entries(), reopened: reopened.entries() };
    },
  },
  {
    name: 'a bad batch is refused before anything is written',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk);
      const ok = { op: 'put', key: 'a', value: '1' };
      const many = Array.from({ length: 65536 }, (_, i) => ({ op: 'put', key: `k${i}`, value: '' }));
      const results = [
        errorOf(() => store.batch('x')),
        errorOf(() => store.batch([])),
        errorOf(() => store.batch(many)),
        errorOf(() => store.batch([ok, { op: 'upsert', key: 'b', value: '1' }])),
        errorOf(() => store.batch([ok, null])),
        errorOf(() => store.batch([ok, { op: 'put', key: 'b' }])),
        errorOf(() => store.batch([ok, { op: 'put', key: 'b', value: 5 }])),
        errorOf(() => store.batch([ok, { op: 'delete', key: 5 }])),
        errorOf(() => store.batch([ok, { op: 'put', key: '', value: '' }])),
        errorOf(() => store.batch([ok, { op: 'put', key: 'x'.repeat(256), value: '' }])),
        errorOf(() => store.batch([ok, { op: 'put', key: 'b', value: '\udc00' }])),
        errorOf(() => store.batch([{ op: 'put', key: 'b', value: '1' }, { op: 'delete', key: '\ud800' }])),
      ];
      const sixtyFive = errorOf(() => store.batch(many.slice(0, 65535)));
      return { results, ops: disk.ops.length, keys: store.keys().length, max: sixtyFive, after: disk.ops.length };
    },
  },
  {
    name: 'put checks types then surrogates then sizes and a refused put changes nothing',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk);
      const results = [
        errorOf(() => store.put(5, 'x')),
        errorOf(() => store.put('k', 5)),
        errorOf(() => store.put(null, null)),
        errorOf(() => store.put('\ud800', 5)),
        errorOf(() => store.put(5, '\ud800')),
        errorOf(() => store.put('', 'x')),
        errorOf(() => store.put('\ud83d', 'x')),
        errorOf(() => store.put('k', 'a\udc00b')),
        errorOf(() => store.put('x'.repeat(256), 'v')),
        errorOf(() => store.put('é'.repeat(128), 'v')),
        errorOf(() => store.put('é'.repeat(127) + 'a', 'v')),
        errorOf(() => store.put('x'.repeat(255), 'v')),
        errorOf(() => store.put('🙂'.repeat(64), 'v')),
        errorOf(() => store.put('🙂'.repeat(63), 'v')),
        errorOf(() => store.put('😀', '😀')),
      ];
      return { results, keys: store.keys().map((k) => k.length), ops: disk.ops.length };
    },
  },
  {
    name: 'a record may not be longer than 16 MiB',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk);
      store.put('small', '1');
      disk.ops.length = 0;
      const tooBig = errorOf(() => store.put('k', 'a'.repeat(16777216)));
      const justTooBig = errorOf(() => store.put('k', 'a'.repeat(16777213)));
      const opsAfterRefusal = disk.ops.length;
      store.put('k', 'a'.repeat(16777212));
      const again = await open(load, disk.survivors());
      return { tooBig, justTooBig, opsAfterRefusal, kept: again.get('k').length, small: again.get('small') };
    },
  },
  {
    name: 'values and keys round trip through UTF-8 including the byte order mark',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk);
      const values = ['﻿start', '', ' ', '\u0000', 'a\nb\r\nc', '🙂🙂', 'ǅ́', '﻿'];
      values.forEach((v, i) => store.put(`k${i}`, v));
      store.put('﻿key', 'bom key');
      store.batch([{ op: 'put', key: 'b', value: '﻿batch' }]);
      const again = await open(load, disk.survivors());
      return { same: values.every((v, i) => again.get(`k${i}`) === v), bomKey: again.get('﻿key'), batch: again.get('b'), count: again.keys().length };
    },
  },
  {
    name: 'a full segment moves on to the next number before the next record and never splits a record',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk, { maxSegmentBytes: 64 });
      const sizes = [];
      for (let i = 0; i < 9; i += 1) {
        store.put(`k${i}`, 'v'.repeat(i * 7));
        sizes.push(store.stats().active);
      }
      return { files: disk.sizes(), active: sizes, stats: store.stats() };
    },
  },
  {
    name: 'a segment of exactly the limit is full and one byte less is not',
    run: async ({ load }) => {
      // P('k0', value) has 8 + 1 + 2 + 2 + value bytes.
      const out = [];
      for (const extra of [0, 1]) {
        const disk = new Disk();
        const store = await open(load, disk, { maxSegmentBytes: 64 });
        store.put('k0', 'v'.repeat(64 - 13 - extra));
        out.push(store.stats().active);
        store.put('k1', 'w');
        out.push(disk.names());
      }
      return out;
    },
  },
  {
    name: 'a store opened on a full last segment writes the next record to the next segment',
    run: async ({ load }) => {
      const disk = new Disk({ [seg(4)]: cat(P('k', 'x'.repeat(60))) });
      const store = await open(load, disk, { maxSegmentBytes: 64 });
      const before = store.stats();
      store.put('n', '1');
      const roomy = await open(load, new Disk({ [seg(4)]: cat(P('k', 'x'.repeat(60))) }), { maxSegmentBytes: 1000 });
      roomy.put('n', '1');
      return { before, after: store.stats(), names: disk.names(), ops: disk.ops };
    },
  },
  {
    name: 'maxSegmentBytes must be an integer of at least 64',
    run: async ({ load }) => {
      const mod = await lib(load);
      return [63, 64, 1.5, '100', NaN, Infinity, -1, null].map((value) => errorOf(() => mod.openStore(new Disk(), { maxSegmentBytes: value })));
    },
  },
  {
    name: 'a store reopened on its files has the same data after rolls deletes and overwrites',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk, { maxSegmentBytes: 80 });
      const expected = new Map();
      for (let i = 0; i < 120; i += 1) {
        const key = `key${(i * 7) % 23}`;
        if (i % 5 === 4) {
          store.delete(key);
          expected.delete(key);
        } else if (i % 11 === 10) {
          store.batch([{ op: 'put', key, value: `b${i}` }, { op: 'delete', key: `key${(i + 1) % 23}` }, { op: 'put', key: 'extra', value: String(i) }]);
          expected.set(key, `b${i}`);
          expected.delete(`key${(i + 1) % 23}`);
          expected.set('extra', String(i));
        } else {
          store.put(key, `val${i}`);
          expected.set(key, `val${i}`);
        }
      }
      const again = await open(load, disk.survivors(), { maxSegmentBytes: 80 });
      const sorted = [...expected].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      return { same: JSON.stringify(again.entries()) === JSON.stringify(sorted), stats: [store.stats(), again.stats()], segments: disk.names().length };
    },
  },
  {
    name: 'files with other names are not part of the store and are never read or changed',
    run: async ({ load }) => {
      const other = { 'seg-1.log': P('x', 'bad'), 'seg-0000001.log': P('x', 'bad'), 'seg-000000.log': P('x', 'bad'), 'xseg-000001.log': P('x', 'bad'), 'seg-000001.log.bak': P('x', 'bad'), 'SEG-000001.LOG': P('x', 'bad'), 'notes.txt': 'plain', 'seg-00000a.log': 'junk' };
      const disk = new Disk({ ...other, [seg(2)]: P('a', '1') });
      const store = await open(load, disk);
      store.put('b', '2');
      store.compact();
      const left = Object.keys(other).every((name) => disk.bytes(name) !== undefined && hex(disk.bytes(name)) === hex(Buffer.from(other[name])));
      return { entries: store.entries(), reads: [...new Set(disk.reads)].sort(), left, files: disk.names().filter((n) => !(n in other)) };
    },
  },
  {
    name: 'every segment is read at most once when a store opens',
    run: async ({ load }) => {
      const disk = new Disk({ [seg(1)]: P('a', '1'), [seg(2)]: P('b', '2'), [seg(3)]: S(1) });
      const allowed = new Set(disk.names());
      const store = await open(load, disk);
      const counts = {};
      for (const name of disk.reads) counts[name] = (counts[name] ?? 0) + 1;
      return { max: Math.max(0, ...Object.values(counts)), onlySegments: Object.keys(counts).every((name) => allowed.has(name)), entries: store.entries() };
    },
  },
  {
    name: 'an omitted or undefined segment option uses the default',
    run: async ({ load }) => {
      const mod = await lib(load);
      return [undefined, {}, { maxSegmentBytes: undefined }, { maxSegmentBytes: 64 }].map((options) => {
        const disk = new Disk();
        const store = mod.openStore(disk, options);
        return [store.entries(), disk.ops.length];
      });
    },
  },
  {
    name: 'a torn tail at every length keeps the records that are whole and cuts the file there',
    run: async ({ load }) => {
      const log = cat(P('a', '1'), P('bb', '22'), D('a'), B([{ op: 'put', key: 'c', value: '3' }]));
      const out = [];
      for (let cut = 0; cut <= log.length; cut += 1) {
        const r = await opened(load, { [seg(1)]: log.subarray(0, cut) });
        out.push([r.error ? 'error' : r.entries.length, r.disk.bytes(seg(1))?.length ?? -1, r.disk.ops.length]);
      }
      return out;
    },
  },
  {
    name: 'a changed byte in the last record drops that record',
    run: async ({ load }) => {
      const first = cat(P('a', '1'), P('bb', '22'));
      const last = P('ccc', '333');
      const out = [];
      for (let at = 0; at < last.length; at += 1) {
        const bad = Buffer.from(last);
        bad[at] ^= 0x40;
        const r = await opened(load, { [seg(1)]: cat(first, bad) });
        out.push([r.error ? 'error' : r.entries.length, r.disk.bytes(seg(1)).length]);
      }
      return out;
    },
  },
  {
    name: 'everything from the first bad record of the last segment on is dropped even when later records are whole',
    run: async ({ load }) => {
      const bad = Buffer.from(P('b', '2'));
      bad[bad.length - 1] ^= 1;
      const r = await opened(load, { [seg(1)]: cat(P('a', '1'), bad, P('c', '3'), P('d', '4')) });
      return { entries: r.entries, size: r.disk.bytes(seg(1)).length, ops: r.disk.ops };
    },
  },
  {
    name: 'a bad record in an older segment is a corruption error with the segment and the offset',
    run: async ({ load }) => {
      const flipped = Buffer.from(P('b', '2'));
      flipped[10] ^= 1;
      const r1 = await opened(load, { [seg(1)]: cat(P('a', '1'), flipped), [seg(2)]: P('c', '3') });
      const r2 = await opened(load, { [seg(1)]: cat(P('a', '1'), P('b', '2'), Buffer.from([1, 2, 3])), [seg(2)]: P('c', '3') });
      const r3 = await opened(load, { [seg(1)]: cat(P('a', '1')), [seg(2)]: cat(P('b', '2'), P('c', '3').subarray(0, 9)), [seg(3)]: P('d', '4') });
      const r4 = await opened(load, { [seg(5)]: cat(P('a', '1').subarray(0, 7)), [seg(6)]: P('c', '3') });
      return [r1.error, r2.error, r3.error, r4.error, r1.disk.ops.length + r2.disk.ops.length + r3.disk.ops.length];
    },
  },
  {
    name: 'the same torn bytes are fine at the end of the last segment',
    run: async ({ load }) => {
      const a = await opened(load, { [seg(1)]: cat(P('a', '1')), [seg(2)]: cat(P('b', '2'), P('c', '3').subarray(0, 9)) });
      const b = await opened(load, { [seg(1)]: cat(P('a', '1'), Buffer.from([1, 2, 3])) });
      return [a.entries, a.disk.bytes(seg(2)).length, b.entries, b.disk.bytes(seg(1)).length];
    },
  },
  {
    name: 'empty segments are fine and a last segment that is all bad is cut to an empty file',
    run: async ({ load }) => {
      const a = await opened(load, { [seg(1)]: Buffer.alloc(0), [seg(2)]: P('a', '1'), [seg(3)]: Buffer.alloc(0) });
      const b = await opened(load, { [seg(1)]: P('a', '1'), [seg(2)]: Buffer.from([9, 9, 9, 9, 9]) });
      b.store.put('z', '26');
      return [a.entries, a.disk.ops, b.entries, b.disk.names(), b.disk.sizes(), b.store.keys()];
    },
  },
  {
    name: 'a record with a good checksum but a body that breaks the format is invalid',
    run: async ({ load }) => {
      const keep = P('a', '1');
      const tail = P('z', '26');
      const bodies = [
        Buffer.from([9, 0, 1, 0x6b]),
        Buffer.alloc(0),
        Buffer.from([1]),
        cat(Buffer.from([1]), be16(0), 'v'),
        cat(Buffer.from([1]), be16(256), 'x'.repeat(256), 'v'),
        cat(Buffer.from([1]), be16(5), 'ab'),
        cat(Buffer.from([1]), be16(1), Buffer.from([0xff]), 'v'),
        cat(Buffer.from([1]), be16(1), 'k', Buffer.from([0xc3, 0x28])),
        cat(Buffer.from([2]), be16(1), 'k', 'extra'),
        cat(Buffer.from([2]), be16(0)),
        cat(Buffer.from([3]), be16(0)),
        cat(bBatch([{ op: 'put', key: 'k', value: 'v' }]), Buffer.from([0])),
        cat(Buffer.from([3]), be16(2), bBatch([{ op: 'put', key: 'k', value: 'v' }]).subarray(3)),
        cat(Buffer.from([3]), be16(1), Buffer.from([3]), be16(1), 'k'),
        cat(Buffer.from([3]), be16(1), Buffer.from([1]), be16(1), 'k', be32(9), 'v'),
        cat(Buffer.from([4]), be32(1), Buffer.from([0])),
        cat(Buffer.from([4]), Buffer.from([0, 0, 1])),
        bSup(0),
        cat(bPut('k', 'v'), Buffer.alloc(0)).subarray(0, 0),
      ];
      const out = [];
      for (const body of bodies) {
        const r = await opened(load, { [seg(1)]: cat(keep, rec(body), tail) });
        out.push(r.error ?? [r.entries.length, r.disk.bytes(seg(1)).length - keep.length]);
      }
      const longHeader = Buffer.concat([be32(0), be32(16777217)]);
      const r = await opened(load, { [seg(1)]: cat(keep, longHeader, Buffer.alloc(20)) });
      out.push([r.entries.length, r.disk.bytes(seg(1)).length - keep.length]);
      return out;
    },
  },
  {
    name: 'the byte order mark and other valid UTF-8 survive a hand written record',
    run: async ({ load }) => {
      const log = cat(rec(cat(Buffer.from([1]), be16(1), 'k', Buffer.from([0xef, 0xbb, 0xbf]), 'v')), rec(cat(Buffer.from([1]), be16(4), Buffer.from([0xf0, 0x9f, 0x99, 0x82]), Buffer.from([0xf0, 0x9f, 0x99, 0x82]))));
      const r = await opened(load, { [seg(1)]: log });
      return r.entries.map(([key, value]) => [key.codePointAt(0).toString(16), [...value].map((ch) => ch.codePointAt(0).toString(16))]);
    },
  },
  {
    name: 'a supersede record is valid only as the first record of a segment',
    run: async ({ load }) => {
      const a = await opened(load, { [seg(1)]: cat(P('a', '1'), S(0), P('b', '2')) });
      const b = await opened(load, { [seg(1)]: cat(S(0), P('b', '2')) });
      const c = await opened(load, { [seg(1)]: P('a', '1'), [seg(2)]: cat(P('b', '2'), S(1)) });
      return [a.entries, a.disk.bytes(seg(1)).length, b.entries, c.entries, c.disk.bytes(seg(2)).length];
    },
  },
  {
    name: 'a supersede record removes the lower segments it names and the highest one counts',
    run: async ({ load }) => {
      const cases = {
        a: { [seg(1)]: P('a', '1'), [seg(2)]: P('b', '2'), [seg(3)]: cat(S(2), P('c', '3')) },
        b: { [seg(1)]: P('a', '1'), [seg(2)]: P('b', '2'), [seg(3)]: cat(S(1), P('c', '3')) },
        c: { [seg(1)]: P('a', '1'), [seg(3)]: cat(S(2), P('c', '3')) },
        d: { [seg(1)]: P('a', '1'), [seg(2)]: cat(S(1), P('x', 'x')), [seg(3)]: cat(S(2), P('y', 'y')), [seg(4)]: P('z', 'z') },
        e: { [seg(1)]: P('a', '1'), [seg(2)]: cat(S(9), P('z', 'z')) },
        f: { [seg(1)]: P('a', '1'), [seg(2)]: P('b', '2'), [seg(3)]: cat(S(7), P('c', '3')), [seg(4)]: cat(S(0), P('d', '4')) },
        g: { [seg(1)]: P('a', '1'), [seg(2)]: cat(S(1), P('b', '2')), [seg(3)]: P('c', '3') },
      };
      const out = {};
      for (const [name, files] of Object.entries(cases)) {
        const r = await opened(load, files);
        out[name] = r.error ?? { entries: r.entries, ops: r.disk.ops, files: r.disk.names() };
      }
      return out;
    },
  },
  {
    name: 'a supersede with a bad checksum is ignored',
    run: async ({ load }) => {
      const bad = Buffer.from(S(5));
      bad[9] ^= 1;
      const r = await opened(load, { [seg(1)]: P('a', '1'), [seg(2)]: P('b', '2'), [seg(3)]: cat(bad, P('c', '3')) });
      return r.error ?? { entries: r.entries, files: r.disk.names() };
    },
  },
  {
    name: 'missing segments are a gap after the superseded ones are gone and the first number may be any',
    run: async ({ load }) => {
      const out = {};
      const runs = {
        gap: { [seg(1)]: P('a', '1'), [seg(2)]: P('b', '2'), [seg(4)]: P('d', '4') },
        late: { [seg(7)]: P('a', '1'), [seg(8)]: P('b', '2') },
        single: { [seg(500000)]: P('a', '1') },
        hole: { [seg(1)]: P('a', '1'), [seg(3)]: P('c', '3'), [seg(4)]: P('d', '4') },
        healed: { [seg(1)]: P('a', '1'), [seg(2)]: P('b', '2'), [seg(4)]: cat(S(3), P('d', '4')) },
        twoholes: { [seg(2)]: P('a', '1'), [seg(5)]: P('b', '2'), [seg(9)]: P('c', '3') },
        tmp: { [seg(1)]: P('a', '1'), [seg(3)]: P('c', '3'), 'compact.tmp': 'half' },
      };
      for (const [name, files] of Object.entries(runs)) {
        const r = await opened(load, files);
        out[name] = r.error ?? { entries: r.entries.length, files: r.disk.names() };
        if (r.error) out[name] = { ...r.error, files: r.disk.names(), ops: r.disk.ops };
      }
      return out;
    },
  },
  {
    name: 'a leftover compact.tmp is removed first and nothing else is touched',
    run: async ({ load }) => {
      const a = await opened(load, { 'compact.tmp': 'garbage' });
      const b = await opened(load, { [seg(1)]: P('a', '1'), 'compact.tmp': P('z', '9') });
      return [a.disk.ops, a.entries, b.disk.ops, b.entries, b.disk.names()];
    },
  },
  {
    name: 'after a repair new writes follow the cut and the next open sees them',
    run: async ({ load }) => {
      const disk = new Disk({ [seg(1)]: cat(P('a', '1'), P('b', '2').subarray(0, 11)) });
      const store = await open(load, disk, { maxSegmentBytes: 100 });
      const first = [store.entries(), store.stats(), disk.ops];
      store.put('c', '3');
      const again = await open(load, disk.survivors(), { maxSegmentBytes: 100 });
      return { first, entries: again.entries(), size: disk.bytes(seg(1)).length, same: hex(disk.bytes(seg(1))) === hex(cat(P('a', '1'), P('c', '3'))) };
    },
  },
  {
    name: 'the active size after a repair decides when the segment is full',
    run: async ({ load }) => {
      const disk = new Disk({ [seg(2)]: cat(P('a', 'x'.repeat(30)), P('b', 'y'.repeat(30)).subarray(0, 40)) });
      const store = await open(load, disk, { maxSegmentBytes: 64 });
      const stats = store.stats();
      store.put('c', '3');
      return { stats, names: disk.names(), after: store.stats() };
    },
  },
  {
    name: 'compact writes the live data in key order behind a supersede record with the exact disk calls',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk, { maxSegmentBytes: 70 });
      store.put('b', 'old');
      store.put('a', '1');
      store.put('c', 'will go');
      store.put('b', 'new');
      store.delete('c');
      store.batch([{ op: 'put', key: 'é', value: 'x' }, { op: 'put', key: 'B', value: 'y' }]);
      const names = disk.names();
      const before = store.stats();
      disk.ops.length = 0;
      const result = store.compact();
      const expected = cat(S(names.length), P('B', 'y'), P('a', '1'), P('b', 'new'), P('é', 'x'));
      return { names, before, result, ops: disk.ops, files: disk.names(), same: hex(disk.bytes(seg(names.length + 1))) === hex(expected), after: store.stats(), entries: store.entries() };
    },
  },
  {
    name: 'writes after a compaction continue in the compacted segment until it is full',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk, { maxSegmentBytes: 100 });
      for (let i = 0; i < 6; i += 1) store.put(`k${i}`, 'v'.repeat(12));
      store.compact();
      const files = disk.sizes();
      store.put('later', '1');
      const small = disk.names();
      const stats = store.stats();
      store.compact();
      return { files, small, stats, second: disk.names(), entries: (await open(load, disk.survivors())).entries().length };
    },
  },
  {
    name: 'compaction of a store with no live keys leaves only the supersede record',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk);
      store.put('a', '1');
      store.delete('a');
      disk.ops.length = 0;
      const result = store.compact();
      return { result, ops: disk.ops, same: hex(disk.bytes(seg(2))) === hex(S(1)), keys: store.keys(), reopened: (await open(load, disk.survivors())).keys(), stats: store.stats() };
    },
  },
  {
    name: 'segment numbers stop at 999999 and a refused write or compaction touches nothing',
    run: async ({ load }) => {
      const disk = new Disk({ [seg(999999)]: P('a', 'x'.repeat(60)) });
      const store = await open(load, disk, { maxSegmentBytes: 64 });
      const out = { compact: errorOf(() => store.compact()), put: errorOf(() => store.put('b', '1')), del: errorOf(() => store.delete('a')), batch: errorOf(() => store.batch([{ op: 'delete', key: 'a' }])), ops: disk.ops.length, get: store.get('a').length };
      const near = new Disk({ [seg(999998)]: P('a', 'x'.repeat(60)) });
      const s2 = await open(load, near, { maxSegmentBytes: 64 });
      s2.put('b', 'y'.repeat(60));
      const full = errorOf(() => s2.put('c', '3'));
      return { out, names: near.names(), full, keys: s2.keys(), ops: near.ops };
    },
  },
  {
    name: 'a crash at every disk call of a compaction leaves files that open to the same data',
    run: async ({ load }) => {
      const base = new Disk();
      const store0 = await open(load, base, { maxSegmentBytes: 70 });
      for (let i = 0; i < 14; i += 1) store0.put(`k${i % 5}`, `value ${i}`);
      store0.delete('k1');
      const files = Object.fromEntries(base.names().map((name) => [name, base.bytes(name)]));
      const want = JSON.stringify(store0.entries());
      const out = [];
      for (let crashAfter = 0; crashAfter < 12; crashAfter += 1) {
        for (const tear of [null, 5]) {
          const disk = new Disk(files);
          const store = await open(load, disk, { maxSegmentBytes: 70 });
          disk.crashAfter = crashAfter;
          disk.tear = tear;
          const err = errorOf(() => store.compact());
          const restart = await opened(load, Object.fromEntries(disk.names().map((name) => [name, disk.bytes(name)])), { maxSegmentBytes: 70 });
          out.push([crashAfter, tear, err === 'no error' ? 'done' : 'crash', restart.error ?? JSON.stringify(restart.entries) === want, restart.disk.names()]);
          if (err === 'no error') break;
        }
      }
      return out;
    },
  },
  {
    name: 'a crash in the middle of an append leaves a torn record that the next open cuts away',
    run: async ({ load }) => {
      const out = [];
      for (const tear of [0, 1, 7, 8, 9, 12]) {
        const disk = new Disk({ [seg(1)]: P('a', '1') });
        const store = await open(load, disk);
        disk.crashAfter = 0;
        disk.tear = tear;
        const err = errorOf(() => store.put('bb', 'new value'));
        const r = await opened(load, Object.fromEntries(disk.names().map((name) => [name, disk.bytes(name)])));
        out.push([tear, err.name ?? err, r.entries, r.disk.bytes(seg(1)).length]);
      }
      return out;
    },
  },
  {
    name: 'a crash during a batch keeps either all of it or none of it',
    run: async ({ load }) => {
      const ops = [{ op: 'put', key: 'x', value: '1' }, { op: 'put', key: 'y', value: '2' }, { op: 'delete', key: 'a' }];
      const whole = B(ops).length;
      const out = [];
      for (let tear = 0; tear <= whole; tear += 3) {
        const disk = new Disk({ [seg(1)]: P('a', '1') });
        const store = await open(load, disk);
        disk.crashAfter = 0;
        disk.tear = tear;
        errorOf(() => store.batch(ops));
        const r = await opened(load, Object.fromEntries(disk.names().map((name) => [name, disk.bytes(name)])));
        out.push([tear, r.entries.length]);
      }
      return out;
    },
  },
  {
    name: 'a disk that throws leaves the data readable after a new open',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk, { maxSegmentBytes: 64 });
      store.put('a', '1');
      disk.crashAfter = disk.mutations;
      const err = errorOf(() => store.put('b', '2'));
      const err2 = errorOf(() => store.compact());
      const r = await opened(load, Object.fromEntries(disk.names().map((name) => [name, disk.bytes(name)])));
      return { err, err2, entries: r.entries };
    },
  },
  {
    name: 'a large store opens compacts and reopens fast without reading the disk for gets',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk, { maxSegmentBytes: 1 << 20 });
      const t0 = cpuMs();
      for (let i = 0; i < 20000; i += 1) store.put(`user:${String(i % 3000).padStart(5, '0')}`, `payload ${i} ${'x'.repeat(i % 40)}`);
      for (let i = 0; i < 3000; i += 3) store.delete(`user:${String(i).padStart(5, '0')}`);
      disk.reads.length = 0;
      let hits = 0;
      for (let i = 0; i < 20000; i += 1) if (store.get(`user:${String(i % 3000).padStart(5, '0')}`) !== undefined) hits += 1;
      const readsDuringGets = disk.reads.length;
      const again = await open(load, disk.survivors(), { maxSegmentBytes: 1 << 20 });
      const result = store.compact();
      const third = await open(load, disk.survivors());
      return { hits, readsDuringGets, keys: [store.keys().length, again.keys().length, third.keys().length], same: JSON.stringify(again.entries()) === JSON.stringify(third.entries()), shrunk: result.bytesAfter < result.bytesBefore, fast: cpuMs() - t0 < 3500 };
    },
  },
  {
    name: 'thousands of tiny segments open and compact fast',
    run: async ({ load }) => {
      const disk = new Disk();
      const store = await open(load, disk, { maxSegmentBytes: 64 });
      const t0 = cpuMs();
      for (let i = 0; i < 4000; i += 1) store.put(`k${i % 700}`, `v${i}`);
      const segments = store.stats().segments;
      const again = await open(load, disk.survivors(), { maxSegmentBytes: 64 });
      const removed = store.compact();
      return { segments, keys: [store.keys().length, again.keys().length], removed: removed.segmentsBefore === segments, files: disk.names().length, fast: cpuMs() - t0 < 3000 };
    },
  },
];
