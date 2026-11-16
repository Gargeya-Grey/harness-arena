import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, parseQuery } from '../src/index.mjs';

const h = () => 'handler';

test('the query string is parsed, and a fragment is ignored', () => {
  const router = createRouter();
  router.add('GET', '/s', h);
  const hit = router.match('GET', '/s?q=cats&page=2#top');
  assert.deepEqual({ ...hit.query }, { q: 'cats', page: '2' });
});

test('a percent-encoded segment is decoded in the parameter', () => {
  const router = createRouter();
  router.add('GET', '/tag/:name', h);
  assert.equal(router.match('GET', '/tag/caf%C3%A9').params.name, 'café');
});

test('empty segments are dropped', () => {
  const router = createRouter();
  router.add('GET', '/a/b', h);
  assert.equal(router.match('GET', '//a///b').status, 200);
});

test('a trailing slash does not matter by default', () => {
  const router = createRouter();
  router.add('GET', '/a', h);
  assert.equal(router.match('GET', '/a/').status, 200);
});

test('a query without a value', () => {
  assert.deepEqual({ ...parseQuery('flag') }, { flag: '' });
});
