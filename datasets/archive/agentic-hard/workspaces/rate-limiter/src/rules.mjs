import { normalizeRule } from './bucket.mjs';

// Rules are { match, burst, perSecond }. `match` is an exact key, a prefix
// ending in * ('user:*'), or '*' for every key.
export function compileRules(rules) {
  return rules.map((rule) => ({ match: rule.match, ...normalizeRule(rule) }));
}

function matches(pattern, key) {
  if (pattern === key) return true;
  return pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1));
}

export function findRule(rules, key) {
  const rule = rules.find((candidate) => matches(candidate.match, key));
  if (!rule) throw new Error(`no rule matches ${key}`);
  return rule;
}
