import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_seqdp.mjs';
import { definition } from '../_families.mjs';

// Words over five letters with forbidden pairs, a cap on repeats and an exact count of
// one letter (the second also caps another letter). There are millions of valid words,
// so the work is a dynamic program by hand: one table per position, each cell a sum.
const CONFIGS = [
  { length: 16, pairs: 9, exactly: 3, atMost: null, min: 5e5, max: 6e6 },
  { length: 18, pairs: 9, exactly: 3, atMost: 2, min: 5e5, max: 6e6 },
];
const MINUTES = [150, 240];

export default () =>
  CONFIGS.map((cfg, i) => {
    const instance = build(makeRng('seqdp', i + 1), cfg);
    const states = 5 * instance.maxRun * (instance.exactly.count + 1) * (instance.atMost ? instance.atMost.count + 1 : 1);
    return definition({
      family: 'seqdp',
      seed: SEED,
      slug: `word-count-${i + 1}`,
      level: 5,
      minutes: MINUTES[i],
      basis: `Estimate, not timed: a table of up to ${states} states (last letter, run, counts) for each of ${instance.length} positions, each cell a sum of up to five earlier cells, about 10 seconds a cell, plus a second pass to check the table.`,
      tags: ['counting', 'dynamic-programming'],
      instance,
    });
  });
