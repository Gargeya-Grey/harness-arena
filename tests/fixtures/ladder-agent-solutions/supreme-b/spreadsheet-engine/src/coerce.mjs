import { makeError } from './values.mjs';

export const NUMBER_TEXT = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

/** A number, or an error value for text that is not a number. Input must not be an error. */
export function toNumber(value) {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = value.trim();
  return NUMBER_TEXT.test(text) ? Number(text) : makeError('#VALUE!');
}

export function toText(value) {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return value;
}

/** A boolean, or an error value. Input must not be an error. */
export function toBool(value) {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const upper = value.toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  return makeError('#VALUE!');
}

const kind = (v) => (v === null ? 'empty' : typeof v);
const RANK = { number: 0, string: 1, boolean: 2 };

/** Sign of the comparison of two values that are not errors (SPEC.md section 4). */
export function compareValues(left, right) {
  let kl = kind(left);
  let kr = kind(right);
  if (kl === 'empty' && kr === 'empty') return 0;
  const defaults = { number: 0, string: '', boolean: false };
  if (kl === 'empty') {
    left = defaults[kr];
    kl = kr;
  } else if (kr === 'empty') {
    right = defaults[kl];
    kr = kl;
  }
  if (kl !== kr) return RANK[kl] - RANK[kr];
  if (kl === 'number') return left < right ? -1 : left > right ? 1 : 0;
  if (kl === 'string') {
    const a = left.toLowerCase();
    const b = right.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return Number(left) - Number(right);
}
