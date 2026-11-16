import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicy, manualClock } from '../src/index.mjs';

const make = (conditions, clock = manualClock(0)) => {
  const policy = createPolicy({ clock });
  policy.defineRole('r');
  policy.setUser('ann', { roles: ['r'], attrs: { dept: 'ops' } });
  policy.addStatement({ id: 's', effect: 'allow', roles: ['r'], actions: ['doc:*'], resources: ['/x'], conditions });
  return policy;
};

test('owner: the user must own the resource', () => {
  const policy = make({ owner: true });
  assert.equal(policy.check('ann', 'doc:read', '/x', { owner: 'ann' }), true);
  assert.equal(policy.check('ann', 'doc:read', '/x', { owner: 'bob' }), false);
});

test('attrs: every attribute must be equal', () => {
  assert.equal(make({ attrs: { dept: 'ops' } }).check('ann', 'doc:read', '/x'), true);
  assert.equal(make({ attrs: { dept: 'dev' } }).check('ann', 'doc:read', '/x'), false);
});

test('mfa: the request must have passed a second factor', () => {
  const policy = make({ mfa: true });
  assert.equal(policy.check('ann', 'doc:read', '/x', { mfa: true }), true);
  assert.equal(policy.check('ann', 'doc:read', '/x', { mfa: false }), false);
});

test('between: the statement works inside a time window', () => {
  const clock = manualClock(50);
  const policy = make({ between: [100, 200] }, clock);
  assert.equal(policy.check('ann', 'doc:read', '/x'), false);
  clock.set(150);
  assert.equal(policy.check('ann', 'doc:read', '/x'), true);
});

test('an unknown condition is refused', () => {
  assert.throws(() => make({ ip: '1.2.3.4' }), /condition/);
});
