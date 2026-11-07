import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, parse, rsort, sort, valid } from '../src/index.mjs';

test('parse reads the parts', () => {
  const v = parse('1.2.3-beta.1+build.5');
  assert.equal(v.major, 1);
  assert.equal(v.minor, 2);
  assert.equal(v.patch, 3);
  assert.equal(v.prerelease.length, 2);
  assert.equal(parse('1.2'), null);
  assert.equal(valid('1.2.3'), true);
  assert.equal(valid('01.2.3'), false);
});

test('compare orders the three numbers as numbers', () => {
  assert.equal(compare('1.2.3', '1.2.3'), 0);
  assert.equal(compare('1.2.3', '1.10.0'), -1);
  assert.equal(compare('2.0.0', '1.99.99'), 1);
  assert.deepEqual(sort(['1.10.0', '1.9.0', '1.2.0', '10.0.0']), ['1.2.0', '1.9.0', '1.10.0', '10.0.0']);
  assert.deepEqual(rsort(['1.0.0', '1.1.0']), ['1.1.0', '1.0.0']);
});

test('a prerelease sorts before its release', () => {
  assert.equal(compare('1.0.0-alpha', '1.0.0'), -1);
  assert.equal(compare('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compare('1.0.0-alpha', '1.0.0-beta'), -1);
});
