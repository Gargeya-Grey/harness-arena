// Cuts a request target into its encoded path segments and its raw query string.
// Dot segments are resolved, empty segments dropped, and the fragment is ignored.
// A segment stays encoded here: %2F is part of one segment, it does not split it.
export function splitTarget(target) {
  const hash = target.indexOf('#');
  const noHash = hash >= 0 ? target.slice(0, hash) : target;
  const mark = noHash.indexOf('?');
  const path = decodeURIComponent(mark >= 0 ? noHash.slice(0, mark) : noHash);
  const query = mark >= 0 ? noHash.slice(mark + 1) : '';
  const segments = [];
  for (const part of path.split('/')) {
    if (part === '') continue;
    segments.push(part);
  }
  return { segments, trailingSlash: segments.length > 0 && path.endsWith('/'), query };
}
