import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.mjs';

test('a closure keeps its variable alive and shares it', () => {
  const source = 'fn make() { let n = 0; fn up() { n = n + 1; return n; } return up; } let a = make(); a(); print(a()); let b = make(); print(b());';
  assert.deepEqual(run(source).output, ['2', '1']);
});

test('a variable declared in a loop body is new in every iteration', () => {
  const source = 'let fs = []; for (let i = 0; i < 3; i = i + 1) { let j = i * 2; push(fs, fn() { return j; }); } print(fs[0]()); print(fs[1]()); print(fs[2]());';
  assert.deepEqual(run(source).output, ['0', '2', '4']);
});

test('errors carry a kind and a position', () => {
  assert.throws(() => run('let x = ;'), (e) => e.kind === 'syntax' && e.message === 'Expect expression.' && e.line === 1 && e.column === 9);
  assert.throws(() => run('{ let a = 1; let a = 2; }'), (e) => e.kind === 'compile' && e.column === 18);
  assert.throws(
    () => run('fn f() {\n  return 1 / 0;\n}\nf();'),
    (e) => e.kind === 'runtime' && e.message === 'Division by zero.' && e.line === 2 && e.column === 12 && e.trace.length === 2,
  );
});

test('print output survives a runtime error', () => {
  assert.throws(() => run('print(1); print(nil + 1);'), (e) => e.output.length === 1 && e.output[0] === '1');
});
