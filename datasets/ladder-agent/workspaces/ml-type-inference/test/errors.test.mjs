import test from 'node:test';
import assert from 'node:assert/strict';
import { typeOf } from '../src/index.mjs';

const error = (source) => {
  const result = typeOf(source);
  assert.equal(result.ok, false, `${source} should not type check`);
  return result.error;
};

test('an unbound variable is reported where it is written', () => {
  assert.deepEqual(error('1 + zz'), { message: 'unbound variable zz', line: 1, col: 5 });
});

test('a mismatch names the expected and the found type', () => {
  assert.deepEqual(error('if 1 then 2 else 3'), { message: 'type mismatch: expected bool but found int', line: 1, col: 4 });
});

test('a call of a value that is not a function', () => {
  assert.deepEqual(error('true 1'), { message: 'not a function: bool', line: 1, col: 1 });
});

test('the lexer reports a stray character', () => {
  assert.deepEqual(error('1 + @'), { message: "unexpected character '@'", line: 1, col: 5 });
});

test('a missing token', () => {
  assert.deepEqual(error('let x = 1'), { message: 'expected \'in\' but found end of input', line: 1, col: 10 });
});

test('a mismatch on a later line', () => {
  assert.deepEqual(error('let a = 1 in\nlet b = true in\na + b'), { message: 'type mismatch: expected int but found bool', line: 3, col: 5 });
});
