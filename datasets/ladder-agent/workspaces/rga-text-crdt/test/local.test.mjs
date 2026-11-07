import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplica } from '../src/index.mjs';

test('typing builds the text', () => {
  const r = createReplica('ann');
  r.insertAt(0, 'helo');
  r.insertAt(3, 'l');
  assert.equal(r.text(), 'hello');
  assert.equal(r.length, 5);
});

test('an insert operation names its place', () => {
  const r = createReplica('ann');
  const [h, i] = r.insertAt(0, 'hi');
  assert.deepEqual(h, { type: 'insert', site: 'ann', seq: 1, clock: 1, after: null, char: 'h' });
  assert.deepEqual(i, { type: 'insert', site: 'ann', seq: 2, clock: 2, after: 'ann@1', char: 'i' });
});

test('deleting a range', () => {
  const r = createReplica('ann');
  r.insertAt(0, 'abcdef');
  const ops = r.deleteAt(1, 3);
  assert.equal(r.text(), 'aef');
  assert.deepEqual(ops.map((op) => op.target), ['ann@2', 'ann@3', 'ann@4']);
});

test('a deleted element stays as a tombstone', () => {
  const r = createReplica('ann');
  r.insertAt(0, 'ab');
  r.deleteAt(0);
  assert.equal(r.text(), 'b');
  assert.equal(r.tombstoneCount(), 1);
  assert.deepEqual(r.elements(), [{ id: 'ann@1', char: 'a', deleted: true }, { id: 'ann@2', char: 'b', deleted: false }]);
});

test('bad indexes are refused', () => {
  const r = createReplica('ann');
  r.insertAt(0, 'ab');
  assert.throws(() => r.insertAt(3, 'x'), RangeError);
  assert.throws(() => r.deleteAt(1, 2), RangeError);
  assert.throws(() => createReplica('a b'), TypeError);
  assert.equal(r.text(), 'ab');
});
