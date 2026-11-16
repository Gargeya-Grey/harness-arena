import test from 'node:test';
import assert from 'node:assert/strict';
import { typeOf } from '../src/index.mjs';

const type = (source) => {
  const result = typeOf(source);
  assert.ok(result.ok, `${source}: ${JSON.stringify(result)}`);
  return result.type;
};

test('literals', () => {
  assert.equal(type('3'), 'int');
  assert.equal(type('"s"'), 'string');
  assert.equal(type('false'), 'bool');
  assert.equal(type('()'), 'unit');
});

test('a function that returns its argument', () => {
  assert.equal(type('fun v -> v'), "'a -> 'a");
});

test('a function type is parenthesised on the left of an arrow', () => {
  assert.equal(type('fun f -> f 1'), "(int -> 'a) -> 'a");
});

test('tuples and lists', () => {
  assert.equal(type('(1, "a")'), 'int * string');
  assert.equal(type('[1; 2]'), 'int list');
  assert.equal(type('[(1, true)]'), '(int * bool) list');
});

test('let introduces a polymorphic name', () => {
  assert.equal(type('let k = fun a -> a in (k 1, k true)'), 'int * bool');
});

test('a recursive function', () => {
  assert.equal(type('let rec down n = if n = 0 then 0 else down (n - 1) in down'), 'int -> int');
});

test('match on a list', () => {
  assert.equal(type('fun l -> match l with [] -> 0 | _ :: _ -> 1'), "'a list -> int");
});

test('operators', () => {
  assert.equal(type('1 + 2 * 3'), 'int');
  assert.equal(type('"a" ^ "b"'), 'string');
  assert.equal(type('1 < 2 && true'), 'bool');
});
