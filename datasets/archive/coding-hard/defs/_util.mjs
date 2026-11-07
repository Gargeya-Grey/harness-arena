// Helpers for the case definitions in this folder.

// One hidden test. `edge` names the rule of the spec that the test checks ("basic"
// for a plain example). When `returns` is left out, generate.mjs computes it with
// the reference solution of the case.
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

export function shuffled(rand, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
