import { systemClock } from './clock.mjs';
import { PolicyError } from './errors.mjs';
import { evaluate } from './evaluate.mjs';
import { createGroups } from './groups.mjs';
import { createPolicySet } from './policy-set.mjs';
import { createRoles } from './roles.mjs';
import { normalizeStatement } from './statement.mjs';

// createPolicy({ clock })
//   defineRole(name, { parents })   defineGroup(name, roleNames)   setUser(id, { roles, groups, attrs })
//   addStatement(statement)   removeStatement(id) -> boolean
//   explain(userId, action, resource, context) -> { allowed, decision: 'deny' | 'allow' | 'default', by: [statement ids] }
//   check(...) -> boolean      effectiveRoles(userId) -> sorted role names
//   context: { owner: id of the owner of the resource, mfa: boolean }
export function createPolicy({ clock = systemClock } = {}) {
  const roles = createRoles();
  const groups = createGroups(roles);
  const users = new Map();
  const policySet = createPolicySet();

  const roleSetOf = (user) => roles.expand([...user.roles, ...groups.rolesOf(user.groups)]);
  const explain = (userId, action, resource, context = {}) => {
    const user = users.get(userId);
    return evaluate({ policySet, user, roleSet: user ? roleSetOf(user) : new Set(), now: clock.now() }, action, resource, context);
  };

  return {
    defineRole: (name, options = {}) => roles.define(name, options.parents ?? []),
    defineGroup: (name, roleNames) => groups.define(name, roleNames),
    setUser(id, { roles: own = [], groups: member = [], attrs = {} } = {}) {
      if (typeof id !== 'string' || id === '') throw new PolicyError('a user id is text');
      for (const role of own) if (!roles.has(role)) throw new PolicyError(`unknown role ${role}`);
      for (const group of member) if (!groups.has(group)) throw new PolicyError(`unknown group ${group}`);
      users.set(id, { id, roles: [...own], groups: [...member], attrs: { ...attrs } });
    },
    addStatement: (raw) => policySet.add(normalizeStatement(raw, roles)),
    removeStatement: (id) => policySet.remove(id),
    explain,
    check: (...args) => explain(...args).allowed,
    effectiveRoles(userId) {
      const user = users.get(userId);
      return user ? [...roleSetOf(user)].sort() : [];
    },
  };
}
