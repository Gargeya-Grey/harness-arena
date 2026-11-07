import { PolicyError } from './errors.mjs';

// A group is a named list of roles that people can be put into.
export function createGroups(roles) {
  const members = new Map();
  return {
    has: (name) => members.has(name),
    define(name, roleNames) {
      if (typeof name !== 'string' || name === '') throw new PolicyError('a group name is text');
      for (const role of roleNames) if (!roles.has(role)) throw new PolicyError(`unknown role ${role}`);
      members.set(name, [...new Set(roleNames)]);
    },
    rolesOf: (names) => names.flatMap((name) => members.get(name) ?? []),
  };
}
