import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.mjs';

test('expressions and print', () => {
  assert.deepEqual(run('print(1 + 2 * 3); print("a" + "b"); print(10 / 4); print(7 % 3);').output, ['7', 'ab', '2.5', '1']);
  assert.deepEqual(run('print(1 < 2 and 2 < 1); print(nil or "x"); print(!0);').output, ['false', 'x', 'false']);
});

test('variables, blocks and shadowing', () => {
  const source = 'let a = 1; { let a = 2; print(a); } print(a); a = 5; print(a);';
  assert.deepEqual(run(source).output, ['2', '1', '5']);
});

test('functions and recursion', () => {
  const source = 'fn fib(n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); } print(fib(15));';
  assert.deepEqual(run(source).output, ['610']);
});

test('loops with break and continue', () => {
  const source = 'for (let i = 0; i < 10; i = i + 1) { if (i == 2) continue; if (i == 5) break; print(i); }';
  assert.deepEqual(run(source).output, ['0', '1', '3', '4']);
});

test('arrays and builtins', () => {
  const source = 'let a = [1, 2]; push(a, 3); a[0] = 9; print(a); print(len(a)); print(type(a));';
  assert.deepEqual(run(source).output, ['[9, 2, 3]', '3', 'array']);
});
