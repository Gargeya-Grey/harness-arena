// Header and trailer lines, and the checks of the header section. See SPEC.md, "Header fields".

/** `bytes` is one line without its CRLF. Returns { name, value } or { code: 'bad-header' }. */
export function parseFieldLine(bytes) {
  throw new Error('not implemented');
}

/**
 * Checks 3 to 5 of "Header fields" on the list of [name, value] pairs and the version.
 * Returns { code } for the first error, or { kind: 'none' } | { kind: 'length', length } | { kind: 'chunked' }.
 */
export function checkHeaderSection(headers, version, limits) {
  throw new Error('not implemented');
}

/** keepAlive for a version and the header list. See SPEC.md, "Connection". */
export function keepAliveOf(headers, version) {
  throw new Error('not implemented');
}
