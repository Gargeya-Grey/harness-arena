import { actionMatches, assertAction } from './action-match.mjs';
import { evaluateConditions } from './conditions.mjs';
import { decide } from './explain.mjs';
import { normalizeResource, resourceMatches } from './resource-match.mjs';

const actionApplies = (statement, action) => statement.actions.some((pattern) => actionMatches(pattern, action)) !== statement.negate;

// Decides one request. `roleSet` holds the user's roles with everything they inherit.
export function evaluate({ policySet, user, roleSet, now }, action, resource, context) {
  assertAction(action);
  const segments = normalizeResource(resource);
  if (!user) return decide([]);
  const matched = [];
  for (const statement of policySet.forRoles(roleSet)) {
    if (!actionApplies(statement, action)) continue;
    if (!statement.resources.some((pattern) => resourceMatches(pattern, user.id, segments, statement.exact))) continue;
    const verdict = evaluateConditions(statement.conditions, { user, context, now });
    // A condition that cannot be told, for lack of an attribute, denies and never allows.
    const applies = verdict === null ? statement.effect === 'deny' : verdict;
    if (applies) matched.push({ id: statement.id, effect: statement.effect });
  }
  return decide(matched);
}
