import { SEED, makeRng } from '../_rng.mjs';
import { build, rookNumbers } from '../_assign.mjs';
import { definition } from '../_families.mjs';

// Nine workers, nine machines, 17 forbidden pairs in a 6 by 6 block. The hand method
// is inclusion and exclusion over the forbidden pairs (a rook polynomial of degree 6).
const CFG = { size: 9, rows: 6, cols: 6, cells: 17, min: 15000, max: 150000 };

export default () => {
  const instance = build(makeRng('assign', 1), CFG);
  const r = rookNumbers(instance);
  return definition({
    family: 'assign',
    seed: SEED,
    slug: 'rook-assignment-1',
    level: 4,
    minutes: 50,
    basis: `Estimate, not timed: 17 forbidden pairs; count the ways to choose k pairs in different rows and columns for k up to ${r.length - 1} (${r.slice(1).join(', ')}), then add them with factorial weights and alternating signs.`,
    tags: ['counting', 'inclusion-exclusion'],
    instance,
  });
};
