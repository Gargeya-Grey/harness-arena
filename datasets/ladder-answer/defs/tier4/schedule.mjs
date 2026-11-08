import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_sched.mjs';
import { definition } from '../_families.mjs';

// Thirteen jobs, three workers. The best of three greedy rules is wrong, and the
// simple lower bound is too low, so the answer needs a search plus a proof that no
// shorter finish exists.
const CFG = { size: 13, workers: 3, minEdges: 12, maxEdges: 18 };
const MINUTES = [40, 45];

export default () =>
  [1, 2].map((n) => {
    const instance = build(makeRng('sched3', n), CFG);
    return definition({
      family: 'sched3',
      seed: SEED,
      slug: `schedule-three-workers-${n}`,
      level: 4,
      minutes: MINUTES[n - 1],
      basis: 'Estimate, not timed: 13 jobs and 3 workers; build a good schedule, then argue by idle-time counting that the next shorter finish is impossible. The lower bound from total work and the longest chain is not tight.',
      tags: ['scheduling', 'search'],
      instance,
    });
  });
