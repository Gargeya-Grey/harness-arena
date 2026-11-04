import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.mjs';

test('parseCsv reads quoted commas', () => {
  assert.deepEqual(parseCsv('"x,y",z'), [['x,y', 'z']]);
});
