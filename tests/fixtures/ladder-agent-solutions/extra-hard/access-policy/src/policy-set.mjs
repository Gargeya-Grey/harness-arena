import { PolicyError } from './errors.mjs';

// The statements by id, in the order they were added.
export function createPolicySet() {
  const byId = new Map();
  return {
    add(statement) {
      if (byId.has(statement.id)) throw new PolicyError(`statement ${statement.id} exists`);
      byId.set(statement.id, statement);
    },
    remove: (id) => byId.delete(id),
    // The statements for someone who holds these roles.
    forRoles: (roleSet) => [...byId.values()].filter((st) => st.roles.includes('*') || st.roles.some((role) => roleSet.has(role))),
  };
}
