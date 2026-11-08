import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_opt-jobs.mjs';
import { optDefinition } from '../_opt-def.mjs';

// One machine, release times, sequence-dependent setups, weighted finish times. Dispatch rules
// and swap searches land a few percent above the optimum; only a search with a proof finds it.
const CONFIGS = [
  { n: 1, slug: 'one-machine-nine-jobs', level: 4, minutes: 60, size: 9, maxRelease: 30, basis: 'Estimate, not timed: 9 jobs; a branch-and-bound by hand over the orders, with a lower bound from release times and the weights, tried against four dispatch rules, and a final check that no cheaper order exists.' },
  { n: 2, slug: 'one-machine-thirteen-jobs', level: 5, minutes: 240, size: 13, maxRelease: 40, basis: 'Estimate, not timed: 13 jobs; the same search by hand, with many more branches to cut and setup times that make every swap change the later start times, and a proof that no cheaper order exists.' },
];

export default () =>
  CONFIGS.map((cfg) =>
    optDefinition({
      family: 'jobs',
      seed: SEED,
      slug: cfg.slug,
      level: cfg.level,
      minutes: cfg.minutes,
      basis: cfg.basis,
      tags: ['scheduling', 'search', 'optimization'],
      instance: build(makeRng('jobs', cfg.n), { size: cfg.size, maxRelease: cfg.maxRelease }),
    }),
  );
