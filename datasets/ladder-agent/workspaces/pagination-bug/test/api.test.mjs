import test from 'node:test';
import assert from 'node:assert/strict';
import { listItems } from '../src/api.mjs';

const items = Array.from({ length: 25 }, (_, i) => i + 1);

test('page 1 holds the first items', () => {
  assert.deepEqual(listItems(items, { page: 1, pageSize: 10 }).items, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('the last page holds the rest', () => {
  assert.deepEqual(listItems(items, { page: 3, pageSize: 10 }).items, [21, 22, 23, 24, 25]);
});

test('pages counts a partly filled last page', () => {
  assert.equal(listItems(items, { pageSize: 10 }).pages, 3);
});

test('hasNext is false on the last page', () => {
  assert.equal(listItems(items, { page: 3, pageSize: 10 }).hasNext, false);
});
