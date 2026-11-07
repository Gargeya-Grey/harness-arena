import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicy, manualClock } from '../src/index.mjs';

const make = (resources, extra = {}) => {
  const policy = createPolicy({ clock: manualClock(0) });
  policy.defineRole('r');
  policy.setUser('ann', { roles: ['r'] });
  policy.addStatement({ id: 's', effect: 'allow', roles: ['r'], actions: ['doc:*'], resources, ...extra });
  return policy;
};

test('a statement covers the folder and everything below it', () => {
  const policy = make(['/projects/42']);
  assert.equal(policy.check('ann', 'doc:read', '/projects/42'), true);
  assert.equal(policy.check('ann', 'doc:read', '/projects/42/docs/7'), true);
  assert.equal(policy.check('ann', 'doc:read', '/projects/43'), false);
});

test('a star matches one segment', () => {
  const policy = make(['/projects/*/docs']);
  assert.equal(policy.check('ann', 'doc:read', '/projects/42/docs'), true);
  assert.equal(policy.check('ann', 'doc:read', '/projects/docs'), false);
});

test('a double star matches any depth', () => {
  const policy = make(['/a/**/z'], { exact: true });
  assert.equal(policy.check('ann', 'doc:read', '/a/b/c/z'), true);
  assert.equal(policy.check('ann', 'doc:read', '/a/z'), true);
  assert.equal(policy.check('ann', 'doc:read', '/a/b'), false);
});

test('a resource must start with a slash', () => {
  const policy = make(['/x']);
  assert.throws(() => policy.check('ann', 'doc:read', 'x'), /resource/);
});

test('the actions are matched by namespace', () => {
  const policy = make(['/x']);
  assert.equal(policy.check('ann', 'doc:delete', '/x'), true);
  assert.equal(policy.check('ann', 'user:read', '/x'), false);
});
