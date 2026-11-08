// What a request path that ends in a slash means. The policy comes from createRouter({ trailingSlash }).
//   'ignore'    (default) the slash does not matter
//   'strict'    '/a/' is not '/a': nothing matches it, the root '/' excepted
//   'redirect'  '/a/' answers 308 to '/a' when '/a' would be found; otherwise it answers like '/a' does
export function trailingAction(policy, hasSlash) {
  if (!hasSlash || policy === 'ignore') return 'match';
  return policy === 'strict' ? 'reject' : 'redirect';
}

export function redirectTo(segments, rawQuery) {
  return `/${segments.join('/')}`;
}
