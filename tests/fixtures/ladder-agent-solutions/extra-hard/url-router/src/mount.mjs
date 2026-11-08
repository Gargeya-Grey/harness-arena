// The pattern of a route of a sub-router mounted under `prefix`.
// Mounting '/' under '/api' gives '/api', not '/api/'.
export function joinPatterns(prefix, pattern) {
  const base = prefix === '/' ? '' : prefix.replace(/\/+$/, '');
  if (pattern === '/') return base || '/';
  return base + pattern;
}
