import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_grid.mjs';
import { definition } from '../_families.mjs';

// Six people, four traits, indirect clues, one seating. Expert time follows the clue
// count: about two and a half minutes per clue to place, cross-check and settle.
const CFG = { seats: 6, kinds: ['drink', 'pet', 'hobby'], minClues: 20, maxClues: 26, minShare: 0.5 };

export default () =>
  [1, 2].map((n) => {
    const instance = build(makeRng('grid-six', n), CFG);
    const minutes = Math.round((instance.clues.length * 2.5) / 5) * 5;
    return definition({
      family: 'grid',
      seed: SEED,
      slug: `grid-six-${n}`,
      level: 4,
      minutes,
      basis: `Estimate, not timed: ${instance.clues.length} clues on a 6 by 4 grid, about 2.5 minutes per clue to place and cross-check; at least half of the clues are indirect (between, either, before, gap).`,
      tags: ['logic', 'search'],
      instance,
    });
  });
