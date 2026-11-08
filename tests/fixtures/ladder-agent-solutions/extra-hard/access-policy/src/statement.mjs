import { assertActionPattern } from './action-match.mjs';
import { assertConditions } from './conditions.mjs';
import { PolicyError } from './errors.mjs';
import { compilePattern } from './resource-match.mjs';

const list = (value, name) => {
  if (!Array.isArray(value) || value.length === 0) throw new PolicyError(`${name} is a list with at least one item`);
  return value;
};

// { id, effect: 'allow' | 'deny', roles: ['*' or role names], actions | notActions: [patterns],
//   resources: [patterns], exact?: boolean, conditions?: { owner, attrs, mfa, between } }
export function normalizeStatement(raw, roles) {
  if (typeof raw?.id !== 'string' || raw.id === '') throw new PolicyError('a statement has an id');
  if (raw.effect !== 'allow' && raw.effect !== 'deny') throw new PolicyError('effect is allow or deny');
  const names = list(raw.roles, 'roles');
  for (const name of names) if (name !== '*' && !roles.has(name)) throw new PolicyError(`unknown role ${name}`);
  if ((raw.actions === undefined) === (raw.notActions === undefined)) throw new PolicyError('give actions or notActions, not both');
  const actions = list(raw.actions ?? raw.notActions, raw.actions ? 'actions' : 'notActions');
  actions.forEach(assertActionPattern);
  const conditions = raw.conditions ?? {};
  assertConditions(conditions);
  return Object.freeze({
    id: raw.id,
    effect: raw.effect,
    roles: [...names],
    actions: [...actions],
    negate: raw.actions === undefined,
    resources: list(raw.resources, 'resources').map(compilePattern),
    exact: raw.exact === true,
    conditions: structuredClone(conditions),
  });
}
