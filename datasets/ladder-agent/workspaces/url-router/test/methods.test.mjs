import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/index.mjs';

const h = () => 'handler';

test('the same path with another method is another route', () => {
  const router = createRouter();
  router.add('GET', '/items', () => 'list');
  router.add('POST', '/items', () => 'create');
  assert.equal(router.match('POST', '/items').handler(), 'create');
  assert.equal(router.match('GET', '/items').handler(), 'list');
});

test('a method nobody handles on a known path is 405', () => {
  const router = createRouter();
  router.add('GET', '/items', h);
  const miss = router.match('DELETE', '/items');
  assert.equal(miss.status, 405);
  assert.ok(miss.allow.includes('GET'));
});

test('HEAD uses the GET handler', () => {
  const router = createRouter();
  router.add('GET', '/items', h);
  assert.equal(router.match('HEAD', '/items').status, 200);
});

test('a router can be mounted under a prefix', () => {
  const api = createRouter();
  api.add('GET', '/ping', h);
  const root = createRouter();
  root.mount('/api', api);
  assert.equal(root.match('GET', '/api/ping').status, 200);
});

test('the same route twice is refused', () => {
  const router = createRouter();
  router.add('GET', '/a', h);
  assert.throws(() => router.add('GET', '/a', h), RangeError);
});
