// The pattern of a route of a sub-router mounted under `prefix`.
// Mounting '/' under '/api' gives '/api', not '/api/'.
export function joinPatterns(prefix, pattern) {
  return prefix.replace(/\/+$/, '') + pattern;
}
