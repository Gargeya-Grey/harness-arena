import { isSite, parseElementId } from './stamp.mjs';

const isPlain = (value) => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const positive = (n) => Number.isInteger(n) && n >= 1;
const oneCodePoint = (s) => typeof s === 'string' && [...s].length === 1;

function checkOp(op) {
  if (!isPlain(op)) throw new TypeError('an operation must be a plain object');
  if (op.type !== 'insert' && op.type !== 'delete') throw new TypeError(`bad operation type ${String(op.type)}`);
  if (!isSite(op.site)) throw new TypeError('bad site');
  if (!positive(op.seq)) throw new TypeError('bad seq');
  if (!positive(op.clock)) throw new TypeError('bad clock');
  if (op.type === 'insert') {
    if (op.after !== null && !parseElementId(op.after)) throw new TypeError('bad after');
    if (!oneCodePoint(op.char)) throw new TypeError('char must be one code point');
  } else if (!parseElementId(op.target)) {
    throw new TypeError('bad target');
  }
}

export function checkOps(ops) {
  if (!Array.isArray(ops)) throw new TypeError('ops must be an array');
  for (const op of ops) checkOp(op);
}

export function copyOp(op) {
  const base = { type: op.type, site: op.site, seq: op.seq, clock: op.clock };
  return op.type === 'insert' ? { ...base, after: op.after, char: op.char } : { ...base, target: op.target };
}
