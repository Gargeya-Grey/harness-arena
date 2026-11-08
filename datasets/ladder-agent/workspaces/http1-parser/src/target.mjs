// The request line and its target. See SPEC.md, "Request line".

/**
 * `line` is the request line as a latin-1 string without its CRLF.
 * Returns { method, target, version } with version '1.0' or '1.1', or { code } with an error code.
 */
export function parseRequestLine(line) {
  throw new Error('not implemented');
}
