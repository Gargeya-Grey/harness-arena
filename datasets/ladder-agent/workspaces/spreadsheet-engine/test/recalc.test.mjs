import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheet } from '../src/index.mjs';

test('set reports the formulas it recomputed, in dependency order', () => {
  const s = createSheet();
  s.set('A1', '1');
  s.set('B1', '=A1+1');
  s.set('C1', '=B1+A1');
  assert.deepEqual(s.set('A1', '5'), ['B1', 'C1']);
  assert.equal(s.get('C1'), 11);
});

test('cells that do not depend on the change are not recomputed', () => {
  const s = createSheet();
  s.set('A1', '1');
  s.set('A2', '2');
  s.set('B1', '=A1*10');
  s.set('B2', '=A2*10');
  const before = s.evaluations();
  assert.deepEqual(s.set('A1', '3'), ['B1']);
  assert.equal(s.evaluations() - before, 1);
});

test('a cycle gives #CYCLE! and can be broken', () => {
  const s = createSheet();
  s.set('A1', '=B1');
  s.set('B1', '=A1');
  assert.deepEqual([s.get('A1'), s.get('B1')], [{ error: '#CYCLE!' }, { error: '#CYCLE!' }]);
  s.set('B1', '7');
  assert.equal(s.get('A1'), 7);
});

test('precedents and dependents', () => {
  const s = createSheet();
  s.set('C3', '=SUM(A1:A2)+B1');
  assert.deepEqual(s.precedents('C3'), ['A1', 'B1', 'A2']);
  assert.deepEqual(s.dependents('A2'), ['C3']);
  assert.deepEqual(s.dependents('C3'), []);
});

test('clearing a cell recomputes its dependents', () => {
  const s = createSheet();
  s.set('A1', '5');
  s.set('A2', '=A1+1');
  assert.deepEqual(s.set('A1', ''), ['A2']);
  assert.equal(s.get('A2'), 1);
  assert.equal(s.get('A1'), null);
});
