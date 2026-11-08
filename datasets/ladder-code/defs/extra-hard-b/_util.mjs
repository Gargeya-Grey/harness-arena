// Helpers for the extra-hard-b definitions in this folder.

// One hidden test. `edge` names the rule of the task text that the test checks ("basic"
// for a plain example, a key of `edges` otherwise). When `returns` is left out,
// generate.mjs computes it with the reference solution of the case.
export const t = (edge, args, ...rest) => ({ edge, args, ...(rest.length ? { returns: rest[0] } : {}) });

// Small deterministic random numbers (mulberry32), so generated inputs never change.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

export const pick = (rand, list) => list[Math.floor(rand() * list.length)];
