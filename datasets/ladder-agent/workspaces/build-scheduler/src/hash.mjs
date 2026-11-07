import { createHash } from 'node:crypto';

/** A short stable hash of a string. */
export const contentHash = (text) => createHash('sha256').update(String(text)).digest('hex').slice(0, 16);

/** A hash of a list of parts; the parts cannot run together. */
export const hashParts = (parts) => contentHash(parts.map((part) => `${String(part).length}:${part}`).join('|'));
