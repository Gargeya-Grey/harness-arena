import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTable, summarize, summarizeChunks } from '../src/index.mjs';

const CSV = 'Region,Amount\nWest,10\nEast,5.5\nWest,2.5\nEast,4.5\n';
const OPTIONS = { groupBy: 'Region', value: 'Amount' };

test('groups are sorted by key and carry count, sum, avg, min and max', () => {
  const summary = summarize(CSV, OPTIONS);
  assert.equal(summary.rows, 4);
  assert.deepEqual(summary.groups, [
    { key: 'East', count: 2, sum: 10, avg: 5, min: 4.5, max: 5.5 },
    { key: 'West', count: 2, sum: 12.5, avg: 6.25, min: 2.5, max: 10 },
  ]);
  assert.deepEqual(summary.total, { count: 4, sum: 22.5, avg: 5.625, min: 2.5, max: 10 });
});

test('text that arrives in pieces gives the same summary', () => {
  const pieces = [CSV.slice(0, 9), CSV.slice(9, 20), CSV.slice(20)];
  assert.deepEqual(summarizeChunks(pieces, OPTIONS), summarize(CSV, OPTIONS));
});

test('an unknown column is an error that names it', () => {
  assert.throws(() => summarize(CSV, { groupBy: 'Country', value: 'Amount' }), /Country/);
});

test('the table has a line per group and a total', () => {
  const lines = renderTable(summarize(CSV, OPTIONS)).split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^group\s+count\s+sum\s+avg$/);
  assert.match(lines[1], /^East\s+2\s+10\.00\s+5\.00$/);
  assert.match(lines[3], /^TOTAL\s+4\s+22\.50\s+5\.63$/);
});
