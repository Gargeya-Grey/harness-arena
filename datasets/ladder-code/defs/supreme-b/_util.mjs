// Helpers for the supreme-b definitions in this folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// A random draw in 0..n-1 from an lcg. The low bits of this generator are weak, so use the high ones.
export const draw = (next, n) => Math.floor((next() / 2147483647) * n);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOLUTIONS = path.join(HERE, '..', '..', '..', '..', 'tests', 'fixtures', 'ladder-code-solutions', 'supreme-b');

// The reference solution of a case as a function. A definition may use it to grow a long input
// (for example a game that stays legal for many actions); the stored expected value always comes
// from the same reference, so the two cannot drift apart.
export function reference(slug, name) {
  const source = fs.readFileSync(path.join(SOLUTIONS, `ladder-code-${slug}.mjs`), 'utf8');
  return new Function(`${source}\nreturn ${name};`)();
}
