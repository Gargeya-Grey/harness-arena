// Records to bytes and back. See SPEC.md, "Files and records".

/** The bytes of one record (crc, length, body) for a body. */
export function frame(body) {
  throw new Error('not implemented');
}

/** The body of a put, delete, batch or supersede record. */
export function putBody(key, value) {
  throw new Error('not implemented');
}

/**
 * Reads the record that starts at `offset` of `bytes`.
 * Returns { ok: true, end, ops } (ops: [{ op, key, value? }], or { supersede: through }) or { ok: false }.
 */
export function readRecord(bytes, offset) {
  throw new Error('not implemented');
}
