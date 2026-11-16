import { PolicyError } from './errors.mjs';

const KEYS = new Set(['owner', 'attrs', 'mfa', 'between']);

export function assertConditions(conditions) {
  if (conditions === null || typeof conditions !== 'object' || Array.isArray(conditions)) throw new PolicyError('conditions are an object');
  for (const [key, value] of Object.entries(conditions)) {
    if (!KEYS.has(key)) throw new PolicyError(`unknown condition ${key}`);
    if ((key === 'owner' || key === 'mfa') && value !== true) throw new PolicyError(`${key} must be true`);
    if (key === 'attrs' && (value === null || typeof value !== 'object' || Array.isArray(value))) throw new PolicyError('attrs is an object');
    if (key === 'between' && !(Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] < value[1])) throw new PolicyError('between is [from, to] with from < to');
  }
}

const UNKNOWN = null;

function one(key, value, { user, context, now }) {
  if (key === 'owner') return context.owner === undefined ? UNKNOWN : context.owner === user.id;
  if (key === 'mfa') return context.mfa === undefined ? UNKNOWN : context.mfa === true;
  if (key === 'between') return value[0] <= now && now <= value[1];
  // attrs: every listed attribute must be there and equal
  let unknown = false;
  for (const [name, want] of Object.entries(value)) {
    const have = user.attrs[name];
    if (have === undefined) unknown = true;
    else if (have !== want) return false;
  }
  return unknown ? UNKNOWN : true;
}

// true, false, or null when an attribute the condition needs is missing and nothing else fails it.
export function evaluateConditions(conditions, state) {
  let unknown = false;
  for (const [key, value] of Object.entries(conditions)) {
    const result = one(key, value, state);
    if (result === false) return false;
    if (result === UNKNOWN) unknown = true;
  }
  return unknown ? UNKNOWN : true;
}
