export const CR = 13;
export const LF = 10;
export const SP = 32;
export const HTAB = 9;

const TOKEN = new Set([...'!#$%&\'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((ch) => ch.charCodeAt(0)));

/** A byte that may appear in a token (method, field name). */
export const isTokenByte = (byte) => TOKEN.has(byte);

/** A byte that may appear in a field value: HTAB, 0x20-0x7E, 0x80-0xFF. */
export const isValueByte = (byte) => byte === HTAB || (byte >= 0x20 && byte <= 0x7e) || byte >= 0x80;

export const isHexByte = (byte) => (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102);

/** Bytes to a string with one character per byte. */
export const latin1 = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.slice(i, i + 8192));
  return out;
};
