import test from 'node:test';
import assert from 'node:assert/strict';
import { createParser, parseCsv, toRecords } from '../src/index.mjs';

test('plain rows, with or without a last line end', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv(''), []);
});

test('empty fields are empty strings', () => {
  assert.deepEqual(parseCsv('a,,c\n,\n'), [['a', '', 'c'], ['', '']]);
});

test('a quoted field may hold a comma', () => {
  assert.deepEqual(parseCsv('a,"b,c"\n'), [['a', 'b,c']]);
});

test('the parser gives back the rows that a chunk completes', () => {
  const parser = createParser();
  assert.deepEqual(parser.write('a,b\n1,'), [['a', 'b']]);
  assert.deepEqual(parser.write('2\n3,4'), [['1', '2']]);
  assert.deepEqual(parser.end(), [['3', '4']]);
});

test('records use the first row as names', () => {
  assert.deepEqual(toRecords(parseCsv('x,y\n1,2\n3,4\n')), [{ x: '1', y: '2' }, { x: '3', y: '4' }]);
});
