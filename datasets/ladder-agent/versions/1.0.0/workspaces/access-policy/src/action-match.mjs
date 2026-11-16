import { PolicyError } from './errors.mjs';

const ACTION = /^[a-z0-9_-]+:[a-z0-9_.-]+$/;
const NAMESPACE_WILDCARD = /^[a-z0-9_-]+:\*$/;

// An action is 'namespace:name', for example 'doc:read'.
export function assertAction(action) {
  if (typeof action !== 'string' || !ACTION.test(action)) throw new PolicyError(`bad action ${String(action)}`);
}

// A pattern is '*', 'namespace:*' or one action.
export function assertActionPattern(pattern) {
  if (pattern !== '*' && !NAMESPACE_WILDCARD.test(pattern) && !ACTION.test(pattern)) throw new PolicyError(`bad action pattern ${String(pattern)}`);
}

export function actionMatches(pattern, action) {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) return action.startsWith(pattern.slice(0, -1));
  return pattern === action;
}
