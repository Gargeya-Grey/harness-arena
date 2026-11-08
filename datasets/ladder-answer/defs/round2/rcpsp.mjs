import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_opt-rcpsp.mjs';
import { optDefinition } from '../_opt-def.mjs';

// A building job with order rules and two shared resources: the shortest finish time. Priority
// rules end two or three hours late; the chain of tasks alone is a weak lower bound.
const CONFIGS = [
  { n: 1, slug: 'building-twelve-tasks', level: 5, minutes: 240, size: 12, cap: [6, 5], extraEdges: 4, basis: 'Estimate, not timed: 12 tasks, 2 shared resources and about 20 order rules; build plans with priority rules, then search for a shorter plan with a bound from the longest chain and the resource use, and prove that the next hour is impossible.' },
  { n: 2, slug: 'building-fourteen-tasks', level: 5, minutes: 360, size: 14, cap: [6, 5], extraEdges: 5, basis: 'Estimate, not timed: 14 tasks, 2 shared resources and about 25 order rules; the same search by hand with many more partial plans, and a proof that a finish one hour earlier is impossible.' },
];

export default () =>
  CONFIGS.map((cfg) =>
    optDefinition({
      family: 'rcpsp',
      seed: SEED,
      slug: cfg.slug,
      level: cfg.level,
      minutes: cfg.minutes,
      basis: cfg.basis,
      tags: ['scheduling', 'resources', 'optimization'],
      instance: build(makeRng('rcpsp', cfg.n), { size: cfg.size, cap: cfg.cap, extraEdges: cfg.extraEdges }),
    }),
  );
