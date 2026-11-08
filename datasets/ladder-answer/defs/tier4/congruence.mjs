import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_congsq.mjs';
import { definition } from '../_families.mjs';

// Six remainder facts with moduli that share factors, plus the twist that the number
// is a perfect square. Merging the facts is the easy part; the square is the search.
const CFG = { count: 6, minPeriod: 20000, maxPeriod: 400000, minRoot: 500, maxRoot: 400000 };

export default () => {
  const instance = build(makeRng('congsq', 1), CFG);
  return definition({
    family: 'congsq',
    seed: SEED,
    slug: 'square-congruence-1',
    level: 4,
    minutes: 60,
    basis: 'Estimate, not timed: find the square roots of each remainder modulo each of six moduli, merge the root classes (moduli share factors), then walk the classes to the smallest root; the plain Chinese-remainder answer is not a square.',
    tags: ['modular', 'search'],
    instance,
  });
};
