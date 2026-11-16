// Text is a string of UTF-16 code units; "a character" in SPEC.md means one code unit.

export const MAX_UNIT = 0xffff;

/** [from, to] pairs (inclusive) for \d \w \s, and the complement pairs for \D \W \S. */
const BASE = {
  d: [[0x30, 0x39]],
  w: [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]],
  s: [[0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0]],
};

function complement(ranges) {
  const out = [];
  let next = 0;
  for (const [from, to] of ranges) {
    if (from > next) out.push([next, from - 1]);
    next = to + 1;
  }
  if (next <= MAX_UNIT) out.push([next, MAX_UNIT]);
  return out;
}

/** The range list of a class escape letter: d D w W s S. */
export function classEscape(letter) {
  const base = BASE[letter.toLowerCase()];
  return letter === letter.toLowerCase() ? base.map((pair) => [...pair]) : complement(base);
}

/** True for a code unit of [A-Za-z0-9_]. */
export function isWordUnit(code) {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f;
}

/** The other ASCII case of a letter code, or the code itself. Only A-Z and a-z fold. */
export function otherCase(code) {
  if (code >= 0x41 && code <= 0x5a) return code + 32;
  if (code >= 0x61 && code <= 0x7a) return code - 32;
  return code;
}
