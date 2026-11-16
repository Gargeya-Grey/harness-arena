import test from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth, formatNumber, renderTable, truncate, wrapLine } from '../src/index.mjs';

test('the width of plain text is its length', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth(''), 0);
});

test('truncate ends the line with the ellipsis', () => {
  assert.equal(truncate('abcdef', 4, '…'), 'abc…');
  assert.equal(truncate('abc', 4, '…'), 'abc');
});

test('wrapLine breaks at spaces', () => {
  assert.deepEqual(wrapLine('aa bb cc', 5), ['aa bb', 'cc']);
  assert.deepEqual(wrapLine('', 5), ['']);
});

test('formatNumber groups the thousands and rounds', () => {
  assert.equal(formatNumber(1234.5, { decimals: 2, thousands: ',' }), '1,234.50');
  assert.equal(formatNumber(3.14159, { decimals: 2 }), '3.14');
  assert.equal(formatNumber(42), '42');
});

test('a centred cell puts the extra space on the right', () => {
  const out = renderTable({ columns: [{ key: 'a', title: 'xxxxxxx', align: 'center' }], rows: [{ a: 'ab' }] });
  assert.ok(out.includes('|   ab    |'));
});
