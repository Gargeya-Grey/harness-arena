import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_opt-steiner.mjs';
import { optDefinition } from '../_opt-def.mjs';

// A cable network with junction fees: a Steiner tree with node costs. The usual constructions
// (nearest depot, joined shortest routes, cut-down spanning tree) are a few units above the optimum.
const CONFIGS = [
  { n: 1, slug: 'cable-five-depots', level: 4, minutes: 60, size: 14, depotCount: 5, edges: 26, basis: 'Estimate, not timed: 14 towns, 5 depots, 26 routes and junction fees; build networks with the usual constructions, then check by dynamic programming over groups of depots (or by trying sets of junction towns) that none is cheaper.' },
  { n: 2, slug: 'cable-seven-depots', level: 5, minutes: 300, size: 20, depotCount: 7, edges: 38, basis: 'Estimate, not timed: 20 towns, 7 depots, 38 routes and junction fees; a Dreyfus-Wagner style table over 127 groups of depots by hand, or a search over the 13 junction towns, and a check of every close competitor.' },
];

export default () =>
  CONFIGS.map((cfg) =>
    optDefinition({
      family: 'steiner',
      seed: SEED,
      slug: cfg.slug,
      level: cfg.level,
      minutes: cfg.minutes,
      basis: cfg.basis,
      tags: ['graph', 'steiner-tree', 'optimization'],
      instance: build(makeRng('steiner', cfg.n), { size: cfg.size, depotCount: cfg.depotCount, edges: cfg.edges }),
    }),
  );
