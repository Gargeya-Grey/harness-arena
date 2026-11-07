import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplica } from '../src/index.mjs';

test('a remote insert is applied', () => {
  const a = createReplica('ann');
  const b = createReplica('bob');
  const applied = b.receive(a.insertAt(0, 'hey'));
  assert.equal(b.text(), 'hey');
  assert.equal(applied.length, 3);
});

test('concurrent edits at the same place converge', () => {
  const a = createReplica('ann');
  const b = createReplica('bob');
  const base = a.insertAt(0, 'ac');
  b.receive(base);
  const fromA = a.insertAt(1, 'X');
  const fromB = [...b.insertAt(1, 'Y'), ...b.insertAt(2, 'Z')];
  a.receive(fromB);
  b.receive(fromA);
  assert.equal(a.text(), b.text());
  assert.equal(a.text().length, 5);
});

test('a longer chain of typing goes first', () => {
  const a = createReplica('ann');
  const b = createReplica('bob');
  b.receive(a.insertAt(0, 'x'));
  a.insertAt(1, 'a');
  const typed = a.insertAt(2, 'b');
  const late = b.insertAt(1, 'zz');
  a.receive(late);
  b.receive(a.opsSince(b.stateVector()));
  assert.equal(a.text(), b.text());
  assert.equal(typed.length, 1);
});

test('a duplicate operation is ignored', () => {
  const a = createReplica('ann');
  const b = createReplica('bob');
  const ops = a.insertAt(0, 'ab');
  b.receive(ops);
  assert.deepEqual(b.receive(ops), []);
  assert.equal(b.text(), 'ab');
});

test('an operation that arrives early waits for the one before it', () => {
  const a = createReplica('ann');
  const b = createReplica('bob');
  const [first, second] = a.insertAt(0, 'ab');
  assert.deepEqual(b.receive([second]), []);
  assert.equal(b.pendingCount(), 1);
  assert.equal(b.receive([first]).length, 2);
  assert.equal(b.text(), 'ab');
  assert.equal(b.pendingCount(), 0);
});

test('merge brings a replica up to date', () => {
  const a = createReplica('ann');
  const b = createReplica('bob');
  a.insertAt(0, 'one');
  b.insertAt(0, 'two');
  a.merge(b);
  b.merge(a);
  assert.equal(a.text(), b.text());
  assert.deepEqual(a.stateVector(), { ann: 3, bob: 3 });
});
