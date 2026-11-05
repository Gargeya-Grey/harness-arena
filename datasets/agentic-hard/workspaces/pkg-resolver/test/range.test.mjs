import test from 'node:test';
import assert from 'node:assert/strict';
import { maxSatisfying, satisfies } from '../src/index.mjs';

test('caret, tilde and plain comparators on full versions', () => {
  assert.equal(satisfies('1.4.0', '^1.2.3'), true);
  assert.equal(satisfies('2.0.0', '^1.2.3'), false);
  assert.equal(satisfies('1.2.9', '~1.2.3'), true);
  assert.equal(satisfies('1.3.0', '~1.2.3'), false);
  assert.equal(satisfies('1.2.3', '1.2.3'), true);
  assert.equal(satisfies('1.2.4', '>1.2.3'), true);
  assert.equal(satisfies('1.2.3', '>=1.0.0 <1.2.3'), false);
});

test('alternatives with ||', () => {
  assert.equal(satisfies('3.1.0', '^1.0.0 || ^3.0.0'), true);
  assert.equal(satisfies('2.1.0', '^1.0.0 || ^3.0.0'), false);
});

test('star and the empty range accept any release', () => {
  assert.equal(satisfies('9.9.9', '*'), true);
  assert.equal(satisfies('0.0.1', ''), true);
});

test('maxSatisfying takes the highest match', () => {
  assert.equal(maxSatisfying(['1.0.0', '1.2.0', '1.1.0', '2.0.0'], '^1.0.0'), '1.2.0');
  assert.equal(maxSatisfying(['1.0.0'], '^2.0.0'), null);
});
