// Small helpers shared by the round-2 optimisation families (_opt-*.mjs). No imports from
// _families.mjs, so a family file may import this without a cycle.

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Number of set bits of a 32-bit integer. */
export function pop(x) {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Index of the lowest set bit of a positive 32-bit integer. */
export const lowBit = (x) => 31 - Math.clz32(x & -x);

/** Ceiling of a/b for positive integers, without float error. */
export const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);

/** All items of `list` joined as "A, B and C". */
export const andList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** Tables of sums over all subsets of `half` items: out[mask] = sum of values[i] for set bits. */
export function subsetSums(values, offset, half) {
  const out = new Int32Array(1 << half);
  for (let mask = 1; mask < 1 << half; mask += 1) {
    const b = lowBit(mask);
    out[mask] = out[mask & (mask - 1)] + values[offset + b];
  }
  return out;
}
