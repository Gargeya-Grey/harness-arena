import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, unifiedDiff, parsePatch, applyPatch, PatchError } from '../src/index.mjs';

test('diffLines keeps the common lines and marks the rest', () => {
  assert.deepEqual(diffLines(['x\n', 'y\n', 'z\n'], ['x\n', 'z\n', 'w\n']), [
    { type: 'equal', line: 'x\n' },
    { type: 'delete', line: 'y\n' },
    { type: 'equal', line: 'z\n' },
    { type: 'insert', line: 'w\n' },
  ]);
  assert.deepEqual(diffLines([], []), []);
});

test('unifiedDiff of one changed line', () => {
  assert.equal(unifiedDiff('1\n2\n3\n', '1\ntwo\n3\n', { oldName: 'old.txt', newName: 'new.txt' }),
    '--- old.txt\n+++ new.txt\n@@ -1,3 +1,3 @@\n 1\n-2\n+two\n 3\n');
  assert.equal(unifiedDiff('same\n', 'same\n'), '');
});

test('unifiedDiff shows a missing final newline', () => {
  assert.equal(unifiedDiff('p\nq', 'p\nq\n'), '--- a\n+++ b\n@@ -1,2 +1,2 @@\n p\n-q\n\\ No newline at end of file\n+q\n');
});

test('hunk headers for an insert at the top and a short file', () => {
  assert.equal(unifiedDiff('', 'n\n'), '--- a\n+++ b\n@@ -0,0 +1 @@\n+n\n');
});

test('parsePatch reads what unifiedDiff writes', () => {
  const patch = parsePatch(unifiedDiff('k\nl\nm\n', 'k\nL\nm\n'));
  assert.equal(patch.hunks.length, 1);
  assert.deepEqual([patch.hunks[0].oldStart, patch.hunks[0].oldCount, patch.hunks[0].newStart, patch.hunks[0].newCount], [1, 3, 1, 3]);
  assert.throws(() => parsePatch('--- a\nnot a header\n'), (error) => error instanceof PatchError && error.code === 'bad-header');
});

test('applyPatch applies a patch, backwards as well', () => {
  const patch = unifiedDiff('one\ntwo\nthree\n', 'one\n2\nthree\n');
  const forward = applyPatch('one\ntwo\nthree\n', patch);
  assert.equal(forward.ok, true);
  assert.equal(forward.text, 'one\n2\nthree\n');
  assert.equal(applyPatch('one\n2\nthree\n', patch, { reverse: true }).text, 'one\ntwo\nthree\n');
});

test('applyPatch finds a hunk that moved', () => {
  const patch = unifiedDiff('a\nb\nc\nd\ne\n', 'a\nb\nC\nd\ne\n', { context: 1 });
  const result = applyPatch('new\nnew\na\nb\nc\nd\ne\n', patch);
  assert.equal(result.text, 'new\nnew\na\nb\nC\nd\ne\n');
  assert.deepEqual(result.hunks, [{ start: 4, offset: 2, fuzz: 0 }]);
});

test('applyPatch reports a hunk that does not fit', () => {
  const patch = unifiedDiff('a\nb\n', 'a\nB\n');
  assert.deepEqual(applyPatch('x\ny\n', patch), { ok: false, hunk: 0 });
});
