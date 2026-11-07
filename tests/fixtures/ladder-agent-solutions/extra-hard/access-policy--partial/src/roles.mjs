import { CycleError, PolicyError } from './errors.mjs';

// Roles and the roles they inherit from.
export function createRoles() {
  const parents = new Map();

  // The names and every role they inherit from, directly or not.
  function expand(names) {
    const seen = new Set();
    const walk = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      for (const parent of parents.get(name) ?? []) walk(parent);
    };
    names.forEach(walk);
    return seen;
  }

  return {
    has: (name) => parents.has(name),
    expand,
    // Defines a role, or replaces its parents. The graph stays as it was when this throws.
    define(name, list = []) {
      if (typeof name !== 'string' || name === '' || name === '*') throw new PolicyError('a role name is text and not *');
      if (list.includes(name) || expand(list).has(name)) throw new CycleError(`role ${name} would inherit from itself`);
      for (const parent of list) if (!parents.has(parent)) throw new PolicyError(`unknown parent role ${parent}`);
      parents.set(name, [...new Set(list)]);
    },
  };
}
