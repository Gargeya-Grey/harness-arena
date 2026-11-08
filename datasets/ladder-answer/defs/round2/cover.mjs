import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_opt-cover.mjs';
import { optDefinition } from '../_opt-def.mjs';

// Minimum-cost multi-cover with conflict pairs. Greedy by cost per district, pruning of unneeded
// masts and one-site swaps all end a few units above the cheapest legal plan.
const CONFIGS = [
  { n: 1, slug: 'relay-masts-sixteen-sites', level: 4, minutes: 60, sites: 16, districts: 14, conflicts: 7, doubleShare: 0.35, basis: 'Estimate, not timed: 16 candidate sites, 14 districts (some need two masts) and 7 conflict pairs; branch on the hardest district with a cost bound by hand, then argue that no cheaper plan is legal.' },
  { n: 2, slug: 'relay-masts-twenty-two-sites', level: 5, minutes: 240, sites: 22, districts: 18, conflicts: 10, doubleShare: 0.4, basis: 'Estimate, not timed: 22 candidate sites, 18 districts (some need two masts) and 10 conflict pairs; the same branching by hand with many more branches, and a proof that no cheaper legal plan exists.' },
];

export default () =>
  CONFIGS.map((cfg) =>
    optDefinition({
      family: 'cover',
      seed: SEED,
      slug: cfg.slug,
      level: cfg.level,
      minutes: cfg.minutes,
      basis: cfg.basis,
      tags: ['set-cover', 'search', 'optimization'],
      instance: build(makeRng('cover', cfg.n), { sites: cfg.sites, districts: cfg.districts, conflicts: cfg.conflicts, doubleShare: cfg.doubleShare }),
    }),
  );
