import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_tour.mjs';
import { definition } from '../_families.mjs';

// A route through every town once, from one town to another, with order rules and a
// toll limit. Nearest neighbour gets stuck or is long, and ignoring the toll limit
// gives a shorter, wrong answer. Thousands of routes fit the rules.
const CONFIGS = [
  { size: 12, roads: 48, tolls: 10, maxTolls: 2, precedences: 3 },
  { size: 13, roads: 54, tolls: 11, maxTolls: 2, precedences: 3 },
];
const MINUTES = [240, 360];

export default () =>
  CONFIGS.map((cfg, i) => {
    const instance = build(makeRng('tour', i + 1), cfg);
    return definition({
      family: 'tour',
      seed: SEED,
      slug: `route-${['twelve', 'thirteen'][i]}-towns`,
      level: 5,
      minutes: MINUTES[i],
      basis: `Estimate, not timed: ${cfg.size} towns and ${cfg.roads} roads; a branch-and-bound by hand over the routes that obey the order rules and the toll limit, with a lower bound to cut branches and a final check of the best route.`,
      tags: ['graph', 'search', 'optimization'],
      instance,
    });
  });
