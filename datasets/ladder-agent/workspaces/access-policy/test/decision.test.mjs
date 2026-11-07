import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicy, manualClock } from '../src/index.mjs';

const make = () => {
  const policy = createPolicy({ clock: manualClock(0) });
  policy.defineRole('viewer');
  policy.defineRole('editor', { parents: ['viewer'] });
  policy.setUser('ann', { roles: ['editor'] });
  policy.setUser('bob', { roles: ['viewer'] });
  return policy;
};

test('nothing is allowed unless a statement allows it', () => {
  const policy = make();
  assert.deepEqual(policy.explain('ann', 'doc:read', '/docs/1'), { allowed: false, decision: 'default', by: [] });
});

test('an allow statement allows', () => {
  const policy = make();
  policy.addStatement({ id: 'read', effect: 'allow', roles: ['viewer'], actions: ['doc:read'], resources: ['/docs'] });
  assert.deepEqual(policy.explain('bob', 'doc:read', '/docs/1'), { allowed: true, decision: 'allow', by: ['read'] });
  assert.equal(policy.check('bob', 'doc:write', '/docs/1'), false);
});

test('a role inherits the statements of its parent role', () => {
  const policy = make();
  policy.addStatement({ id: 'read', effect: 'allow', roles: ['viewer'], actions: ['doc:read'], resources: ['/docs'] });
  assert.equal(policy.check('ann', 'doc:read', '/docs/1'), true);
});

test('a deny beats an allow that was added after it', () => {
  const policy = make();
  policy.addStatement({ id: 'no', effect: 'deny', roles: ['viewer'], actions: ['doc:*'], resources: ['/docs/secret'] });
  policy.addStatement({ id: 'yes', effect: 'allow', roles: ['viewer'], actions: ['doc:*'], resources: ['/docs'] });
  assert.equal(policy.check('bob', 'doc:read', '/docs/secret'), false);
  assert.equal(policy.check('bob', 'doc:read', '/docs/open'), true);
});

test('a deny that was added after an allow still wins', () => {
  const policy = make();
  policy.addStatement({ id: 'yes', effect: 'allow', roles: ['viewer'], actions: ['doc:*'], resources: ['/docs'] });
  policy.addStatement({ id: 'no', effect: 'deny', roles: ['viewer'], actions: ['doc:*'], resources: ['/docs/secret'] });
  assert.equal(policy.check('bob', 'doc:read', '/docs/secret'), false);
});

test('an unknown user is denied', () => {
  const policy = make();
  assert.equal(policy.check('zed', 'doc:read', '/docs/1'), false);
});

test('a role cannot inherit from itself', () => {
  const policy = make();
  assert.throws(() => policy.defineRole('viewer', { parents: ['viewer'] }), /inherit/);
});
