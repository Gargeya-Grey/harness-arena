import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheet } from '../src/index.mjs';

test('cell input becomes numbers, text and booleans', () => {
  const s = createSheet();
  s.set('A1', '12.5');
  s.set('A2', 'hello');
  s.set('A3', 'true');
  s.set('A4', "'42");
  assert.deepEqual([s.get('A1'), s.get('A2'), s.get('A3'), s.get('A4'), s.get('B9')], [12.5, 'hello', true, '42', null]);
  assert.equal(s.input('A4'), "'42");
});

test('a formula is computed from other cells', () => {
  const s = createSheet();
  s.set('A1', '4');
  s.set('A2', '=A1*2+1');
  assert.equal(s.get('A2'), 9);
  s.set('A1', '10');
  assert.equal(s.get('A2'), 21);
});

test('operators follow the usual precedence', () => {
  const s = createSheet();
  s.set('A1', '=1+2*3');
  s.set('A2', '=(1+2)*3');
  s.set('A3', '="a"&"b"');
  s.set('A4', '=2<3');
  assert.deepEqual([s.get('A1'), s.get('A2'), s.get('A3'), s.get('A4')], [7, 9, 'ab', true]);
});

test('functions over ranges', () => {
  const s = createSheet();
  for (const [ref, v] of [['B1', '1'], ['B2', '2'], ['B3', '3'], ['B4', 'x']]) s.set(ref, v);
  s.set('C1', '=SUM(B1:B4)');
  s.set('C2', '=MAX(B1:B3)');
  s.set('C3', '=COUNT(B1:B4)');
  assert.deepEqual([s.get('C1'), s.get('C2'), s.get('C3')], [6, 3, 3]);
});

test('errors are values', () => {
  const s = createSheet();
  s.set('A1', '=1/0');
  s.set('A2', '=A1+1');
  assert.deepEqual(s.get('A2'), { error: '#DIV/0!' });
});

test('bad references are refused', () => {
  const s = createSheet();
  assert.throws(() => s.set('A0', '1'), RangeError);
  assert.throws(() => s.get('1A'), RangeError);
  assert.throws(() => s.set('A1', 5), TypeError);
});
