// Family "congsq": the smallest positive perfect square that fits six remainder facts
// whose moduli share factors. The twist is the square: the facts alone have many
// solutions, and most of them are not squares. The instance is
//   { thing, congruences: [{ mod, rem, style }] }
//
// Two exact methods that share no code:
//   smallestScan    tries n = 1, 2, 3, ... and tests n * n against every fact
//   smallestRoots   lists, for every modulus, the residues n whose square leaves the
//                   stated remainder, then walks n over one full period
// The shortcut is the usual Chinese-remainder answer that ignores the square rule:
// the smallest number that fits the facts.



const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a / gcd(a, b)) * b;

export const periodOf = (instance) => instance.congruences.map((c) => c.mod).reduce(lcm, 1);

export function smallestScan(instance, limit = 20_000_000) {
  for (let n = 1; n <= limit; n += 1) {
    const square = n * n;
    if (instance.congruences.every(({ mod, rem }) => square % mod === rem)) return square;
  }
  throw new Error('congsq: no square below the scan limit');
}

export function smallestRoots(instance) {
  const roots = instance.congruences.map(({ mod, rem }) => {
    const set = new Set();
    for (let r = 0; r < mod; r += 1) if ((r * r) % mod === rem) set.add(r);
    return { mod, set };
  });
  const period = periodOf(instance);
  for (let n = 1; n <= period; n += 1) {
    if (roots.every(({ mod, set }) => set.has(n % mod))) return n * n;
  }
  throw new Error('congsq: no square in one period');
}

/** The smallest positive number that fits the facts, squares or not. */
export function smallestAny(instance) {
  for (let x = 1; ; x += 1) if (instance.congruences.every(({ mod, rem }) => x % mod === rem)) return x;
}

export function solve(instance) {
  return { answer: smallestRoots(instance) };
}

export function solveProved(instance) {
  const answer = smallestRoots(instance);
  if (smallestScan(instance) !== answer) throw new Error('congsq: the two methods disagree');
  return { answer };
}

export function shortcuts(instance) {
  return [{ name: 'solve the remainder facts and ignore the square rule', answer: smallestAny(instance) }];
}

const MODS = [9, 12, 16, 18, 20, 24, 25, 28, 30, 32, 35, 36, 40, 42, 44, 45, 48, 49, 50, 52, 54, 56, 60, 63, 64, 66, 72, 75, 80, 84, 88, 90, 96, 99];
const THINGS = ['tiles', 'crates', 'coins', 'bottles', 'beads', 'tickets'];

export function build(rng, cfg) {
  const { count, minPeriod, maxPeriod, minRoot, maxRoot } = cfg;
  return rng.attempt(() => {
    const mods = rng.sample(MODS, count);
    if (mods.some((a) => mods.some((b) => a !== b && b % a === 0))) return null;
    let sharing = 0;
    for (let i = 0; i < count; i += 1) for (let j = i + 1; j < count; j += 1) if (gcd(mods[i], mods[j]) > 1) sharing += 1;
    if (sharing < 6) return null;
    const period = mods.reduce(lcm, 1);
    if (period < minPeriod || period > maxPeriod) return null;
    const hidden = rng.int(minRoot, Math.min(maxRoot, period));
    const styles = ['rem', 'short', 'over'];
    const congruences = mods.map((mod, i) => ({ mod, rem: (hidden * hidden) % mod, style: styles[i % 3] }));
    if (congruences.some((c) => c.rem === 0)) return null;
    const instance = { thing: rng.pick(THINGS), congruences };
    const answer = smallestRoots(instance);
    if (Math.sqrt(answer) < minRoot || answer > Number.MAX_SAFE_INTEGER) return null;
    // The rule must bite: the plain answer is smaller, and it is not a square.
    const plain = smallestAny(instance);
    return plain < answer && Number.isInteger(Math.sqrt(plain)) === false ? instance : null;
  }, 4000);
}

export function render(instance) {
  const { thing, congruences } = instance;
  const fact = (c) => {
    if (c.style === 'rem') return `When it is counted in groups of ${c.mod}, ${c.rem} ${c.rem === 1 ? thing.slice(0, -1) : thing} are left over.`;
    if (c.style === 'short') return `When it is counted in groups of ${c.mod}, the last group is ${c.mod - c.rem} short of a full group.`;
    return `The number is exactly ${c.rem} more than a multiple of ${c.mod}.`;
  };
  return [
    `A depot keeps a positive whole number of ${thing} in storage. The depot manager says that all of the following facts are true:`,
    '',
    ...congruences.map((c, i) => `${i + 1}. ${fact(c)}`),
    `${congruences.length + 1}. The number is a perfect square: it equals n times n for some whole number n.`,
    '',
    `What is the smallest possible number of ${thing}?`,
    'Answer format: a whole number.',
  ].join('\n');
}
