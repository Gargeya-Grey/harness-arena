import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, MemDisk, CorruptionError } from '../src/index.mjs';

test('put, get, delete and sorted keys', () => {
  const store = openStore(new MemDisk());
  store.put('b', '2');
  store.put('a', '1');
  store.put('ab', '3');
  assert.equal(store.get('a'), '1');
  assert.equal(store.get('zz'), undefined);
  assert.deepEqual(store.keys(), ['a', 'ab', 'b']);
  assert.deepEqual(store.keys('a'), ['a', 'ab']);
  assert.equal(store.delete('a'), true);
  assert.equal(store.delete('a'), false);
  assert.deepEqual(store.entries(), [['ab', '3'], ['b', '2']]);
});

test('a new store on the same disk sees the data', () => {
  const disk = new MemDisk();
  const first = openStore(disk);
  first.put('k', 'v1');
  first.put('k', 'v2');
  first.put('gone', 'x');
  first.delete('gone');
  const second = openStore(disk);
  assert.equal(second.get('k'), 'v2');
  assert.equal(second.has('gone'), false);
  assert.equal(second.stats().keys, 1);
});

test('a batch is applied in order', () => {
  const disk = new MemDisk();
  const store = openStore(disk);
  store.batch([{ op: 'put', key: 'x', value: '1' }, { op: 'put', key: 'y', value: '2' }, { op: 'delete', key: 'x' }]);
  assert.deepEqual(openStore(disk).entries(), [['y', '2']]);
});

test('segments roll over at the size limit', () => {
  const disk = new MemDisk();
  const store = openStore(disk, { maxSegmentBytes: 64 });
  for (let i = 0; i < 12; i += 1) store.put(`key${i}`, 'v'.repeat(20));
  assert.ok(disk.list().length > 3);
  assert.equal(openStore(disk, { maxSegmentBytes: 64 }).keys().length, 12);
});

test('compaction keeps the live data in one segment', () => {
  const disk = new MemDisk();
  const store = openStore(disk, { maxSegmentBytes: 64 });
  for (let i = 0; i < 20; i += 1) store.put(`k${i % 4}`, `value ${i}`);
  store.delete('k0');
  const before = store.stats().segments;
  const result = store.compact();
  assert.equal(result.segmentsBefore, before);
  assert.equal(store.stats().segments, 1);
  assert.deepEqual(openStore(disk).keys(), ['k1', 'k2', 'k3']);
});

test('a torn last record is dropped when the store opens', () => {
  const disk = new MemDisk();
  const store = openStore(disk);
  store.put('a', '1');
  store.put('b', '2');
  const [name] = disk.list();
  const bytes = disk.read(name);
  disk.write(name, bytes.slice(0, bytes.length - 3));
  const again = openStore(disk);
  assert.deepEqual(again.entries(), [['a', '1']]);
  assert.equal(disk.read(name).length, again.stats().bytes);
});

test('damage in an older segment is an error', () => {
  const disk = new MemDisk();
  const store = openStore(disk, { maxSegmentBytes: 64 });
  for (let i = 0; i < 8; i += 1) store.put(`k${i}`, 'x'.repeat(30));
  const first = disk.read('seg-000001.log');
  first[12] ^= 0xff;
  disk.write('seg-000001.log', first);
  assert.throws(() => openStore(disk, { maxSegmentBytes: 64 }), (error) => error instanceof CorruptionError && error.segment === 1);
});
