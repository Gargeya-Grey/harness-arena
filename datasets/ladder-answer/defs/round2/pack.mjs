import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_opt-pack.mjs';
import { optDefinition } from '../_opt-def.mjs';

// A two-limit knapsack with conflict pairs and per-shipper limits. Greedy loads and one-crate
// swaps are a few units short; the best load needs a search with a bound.
const CONFIGS = [
  { n: 1, slug: 'cargo-hold-eighteen-crates', level: 4, minutes: 75, size: 18, shippers: 4, conflicts: 6, basis: 'Estimate, not timed: 18 crates, two capacity limits, 6 conflict pairs and 4 shipper limits; a branch-and-bound by hand with a combined-capacity bound, checked against the best greedy loads.' },
  { n: 2, slug: 'cargo-hold-twenty-three-crates', level: 5, minutes: 240, size: 23, shippers: 5, conflicts: 8, basis: 'Estimate, not timed: 23 crates, two capacity limits, 8 conflict pairs and 5 shipper limits; the same search by hand with far more branches, and a proof that no heavier-value load is legal.' },
];

export default () =>
  CONFIGS.map((cfg) =>
    optDefinition({
      family: 'pack',
      seed: SEED,
      slug: cfg.slug,
      level: cfg.level,
      minutes: cfg.minutes,
      basis: cfg.basis,
      tags: ['knapsack', 'search', 'optimization'],
      instance: build(makeRng('pack', cfg.n), { size: cfg.size, shippers: cfg.shippers, conflicts: cfg.conflicts }),
    }),
  );
