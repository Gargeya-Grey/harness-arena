import { normalizeRule } from './bucket.mjs';

// Rules are { match, burst, perSecond }. `match` is an exact key, a prefix
// ending in * ('user:*'), or '*' for every key. The most specific rule wins:
// the exact key, then the longest prefix, then '*'. Between rules that match
// equally well, the one listed first wins.
export function compileRules(rules) {
  return rules.map((rule) => ({ match: rule.match, ...normalizeRule(rule) }));
}

function score(pattern, key) {
  if (pattern === key) return Number.MAX_SAFE_INTEGER;
  if (pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1))) return pattern.length - 1;
  return -1;
}

export function findRule(rules, key) {
  let best = null;
  let bestScore = -1;
  for (const rule of rules) {
    const s = score(rule.match, key);
    if (s > bestScore) {
      best = rule;
      bestScore = s;
    }
  }
  if (best === null) throw new Error(`no rule matches ${key}`);
  return best;
}
