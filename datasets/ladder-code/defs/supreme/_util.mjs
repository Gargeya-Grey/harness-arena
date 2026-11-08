// Helpers for the supreme definitions in this folder.

// One hidden test. `edge` names the rule of the task text that the test checks ("basic"
// for a plain example, a key of `edges` otherwise). When `returns` is left out,
// generate.mjs computes it with the reference solution of the case.
export const t = (edge, args, ...rest) => ({ edge, args, ...(rest.length ? { returns: rest[0] } : {}) });

// The generator that the task texts write out: x_0 = seed, x_{i+1} = (x_i * 48271 + 11) mod 2147483647.
// Only used to build compact arguments; the reference solutions carry their own copy.
export function lcg(seed) {
  let x = seed;
  return () => {
    x = (x * 48271 + 11) % 2147483647;
    return x;
  };
}
