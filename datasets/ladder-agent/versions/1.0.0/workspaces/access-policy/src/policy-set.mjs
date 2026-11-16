// The statements by id, and by the roles they are for.
export function createPolicySet() {
  const byId = new Map();
  const byRole = new Map();
  return {
    add(statement) {
      byId.set(statement.id, statement);
      for (const role of statement.roles) {
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role).push(statement);
      }
    },
    remove: (id) => byId.delete(id),
    // The statements for someone who holds these roles.
    forRoles: (roleSet) => ['*', ...roleSet].flatMap((role) => byRole.get(role) ?? []),
  };
}
