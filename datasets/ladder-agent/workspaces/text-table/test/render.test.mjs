import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTable } from '../src/index.mjs';

const columns = [
  { key: 'name', title: 'Name' },
  { key: 'qty', title: 'Qty', type: 'number' },
];
const rows = [
  { name: 'apple', qty: 3 },
  { name: 'fig', qty: 12 },
];

test('an ascii table with a header rule', () => {
  assert.equal(
    renderTable({ columns, rows }),
    ['+-------+-----+', '| Name  | Qty |', '+-------+-----+', '| apple |   3 |', '| fig   |  12 |', '+-------+-----+'].join('\n'),
  );
});

test('a unicode table', () => {
  assert.equal(
    renderTable({ columns, rows, border: 'unicode' }),
    ['┌───────┬─────┐', '│ Name  │ Qty │', '├───────┼─────┤', '│ apple │   3 │', '│ fig   │  12 │', '└───────┴─────┘'].join('\n'),
  );
});

test('a table without borders has no trailing spaces', () => {
  assert.equal(renderTable({ columns, rows, border: 'none' }), [' Name   Qty', ' apple    3', ' fig     12'].join('\n'));
});

test('a long cell is cut with an ellipsis', () => {
  const out = renderTable({ columns: [{ key: 'a', title: 'A', maxWidth: 5 }], rows: [{ a: 'abcdefghij' }] });
  assert.ok(out.includes('| abcd… |'));
});

test('a wrapping column grows in height', () => {
  const out = renderTable({ columns: [{ key: 'a', title: 'A', maxWidth: 9, overflow: 'wrap' }], rows: [{ a: 'hello big world' }] });
  assert.deepEqual(out.split('\n').slice(3, 5), ['| hello big |', '| world     |']);
});

test('a new line in a cell makes more lines in the row', () => {
  const out = renderTable({ columns, rows: [{ name: 'a\nb', qty: 1 }], border: 'none' });
  assert.deepEqual(out.split('\n'), [' Name  Qty', ' a       1', ' b']);
});

test('a table that is too wide shrinks its widest column', () => {
  const out = renderTable({ columns: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }], rows: [{ a: 'abcdefgh', b: 'xy' }], maxWidth: 12 });
  assert.ok(out.split('\n').every((line) => line.length <= 12));
  assert.ok(out.includes('| ab… | xy |'));
});

test('a Hangul name takes two columns for each letter', () => {
  const out = renderTable({ columns: [{ key: 'n', title: 'Name' }], rows: [{ n: '한국' }] });
  assert.ok(out.includes('| 한국 |'));
});
