import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.mjs';

test('basic', () => {
  assert.deepEqual(parseCsv('a,b\nc,d'), [['a','b'],['c','d']]);
});

test('trailing newline ignored', () => {
  assert.deepEqual(parseCsv('a,b\nc,d\n'), [['a','b'],['c','d']]);
  assert.deepEqual(parseCsv('a,b\nc,d\r\n'), [['a','b'],['c','d']]);
});

test('crlf', () => {
  assert.deepEqual(parseCsv('a,b\r\nc,d\r\n'), [['a','b'],['c','d']]);
});

test('quoted comma', () => {
  assert.deepEqual(parseCsv('"a,b",c'), [['a,b','c']]);
});

test('quoted newline', () => {
  assert.deepEqual(parseCsv('"a\nb",c'), [['a\nb','c']]);
  assert.deepEqual(parseCsv('"a\r\nb",c'), [['a\r\nb','c']]);
});

test('doubled quotes', () => {
  assert.deepEqual(parseCsv('""""'), [['"']]);
  assert.deepEqual(parseCsv('"a""b"'), [['a"b']]);
});

test('empty field', () => {
  assert.deepEqual(parseCsv('a,,b'), [['a','','b']]);
  assert.deepEqual(parseCsv(''), [['']]);
});

test('empty input trailing', () => {
  assert.deepEqual(parseCsv('\n'), [['']]);
});