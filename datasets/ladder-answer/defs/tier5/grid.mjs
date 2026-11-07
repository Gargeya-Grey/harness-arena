import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_grid.mjs';
import { definition } from '../_families.mjs';

// Seven people, five traits, about 30 indirect clues, one seating. A grid this size
// cannot be read off: it needs several rounds of case splits. Expert time follows the
// clue count at about five minutes a clue, since each clue is checked against a
// larger set of open cells and often has to be revisited after a split.
const CFG = { seats: 7, kinds: ['drink', 'pet', 'hobby', 'trade'], minClues: 27, maxClues: 36, minShare: 0.5 };

export default () =>
  [1, 2].map((n) => {
    const instance = build(makeRng('grid-seven', n), CFG);
    const minutes = Math.round((instance.clues.length * 5) / 5) * 5;
    return definition({
      family: 'grid',
      seed: SEED,
      slug: `grid-seven-${n}`,
      level: 5,
      minutes,
      basis: `Estimate, not timed: ${instance.clues.length} clues on a 7 by 5 grid (35 items), about five minutes a clue including case splits and a final check of every clue.`,
      tags: ['logic', 'search'],
      instance,
    });
  });
