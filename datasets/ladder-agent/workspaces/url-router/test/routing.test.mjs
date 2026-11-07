import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, parsePattern } from '../src/index.mjs';

const h = () => 'handler';

test('a static route and a parameter route', () => {
  const router = createRouter();
  router.add('GET', '/users', h);
  router.add('GET', '/users/:id', h);
  assert.equal(router.match('GET', '/users').route, '/users');
  const hit = router.match('GET', '/users/42');
  assert.equal(hit.status, 200);
  assert.deepEqual({ ...hit.params }, { id: '42' });
});

test('a static segment beats a parameter whatever the order of registration', () => {
  const router = createRouter();
  router.add('GET', '/users/:id', h);
  router.add('GET', '/users/me', h);
  assert.equal(router.match('GET', '/users/me').route, '/users/me');
  assert.equal(router.match('GET', '/users/mel').route, '/users/:id');
});

test('an unknown path is 404', () => {
  const router = createRouter();
  router.add('GET', '/a', h);
  assert.deepEqual(router.match('GET', '/b'), { status: 404 });
});

test('a pattern is parsed into segments', () => {
  assert.deepEqual(parsePattern('/a/:id<int>/*'), [
    { kind: 'static', value: 'a' },
    { kind: 'param', name: 'id', type: 'int', optional: false },
    { kind: 'any' },
  ]);
});

test('a bad pattern is refused', () => {
  const router = createRouter();
  assert.throws(() => router.add('GET', 'users', h), RangeError);
  assert.throws(() => router.add('GET', '/a//b', h), RangeError);
  assert.throws(() => router.add('GET', '/a/**/b', h), RangeError);
});

test('a rest segment captures what is left', () => {
  const router = createRouter();
  router.add('GET', '/files/**', h);
  assert.equal(router.match('GET', '/files/a/b/c').params['**'], 'a/b/c');
  assert.equal(router.match('GET', '/files/a').params['**'], 'a');
});
