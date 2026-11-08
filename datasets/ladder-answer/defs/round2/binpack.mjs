import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_opt-binpack.mjs';
import { optDefinition } from '../_opt-def.mjs';

// Packing into boxes of three sizes with conflict pairs, at least total price. First-fit and
// best-fit rules, and a one-parcel move search, end one price step above the optimum.
const BOXES = [
  { name: 'Small', cap: 10, price: 7 },
  { name: 'Medium', cap: 17, price: 11 },
  { name: 'Large', cap: 26, price: 15 },
];
const CONFIGS = [
  { n: 1, slug: 'box-shipping-thirteen-parcels', level: 4, minutes: 90, size: 13, conflicts: 9, basis: 'Estimate, not timed: 13 parcels, 3 box types and 9 conflict pairs; try the packing rules, then search for a cheaper grouping with a price bound and check that no grouping is cheaper.' },
  { n: 2, slug: 'box-shipping-seventeen-parcels', level: 5, minutes: 300, size: 17, conflicts: 12, basis: 'Estimate, not timed: 17 parcels, 3 box types and 12 conflict pairs; the same search by hand over groupings, which grow very fast, and a proof that no grouping is cheaper.' },
];

export default () =>
  CONFIGS.map((cfg) =>
    optDefinition({
      family: 'binpack',
      seed: SEED,
      slug: cfg.slug,
      level: cfg.level,
      minutes: cfg.minutes,
      basis: cfg.basis,
      tags: ['bin-packing', 'search', 'optimization'],
      instance: build(makeRng('binpack', cfg.n), { size: cfg.size, conflicts: cfg.conflicts, boxes: BOXES }),
    }),
  );
