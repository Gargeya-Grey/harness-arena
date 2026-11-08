import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_opt-edit.mjs';
import { optDefinition } from '../_opt-def.mjs';

// A weighted edit distance with letter classes and run-length gap costs. Fewest-edits alignments,
// greedy steps and common-subsequence alignments price a few units above the best alignment.
const CFG = { n: 1, length: 18, edits: 7 };

export default () => [
  optDefinition({
    family: 'edit',
    seed: SEED,
    slug: 'weighted-word-edit',
    level: 4,
    minutes: 50,
    basis: 'Estimate, not timed: two words of about 20 letters; a three-table dynamic programme (match, deletion run, insertion run) of about 400 cells filled by hand with care, plus a check of a few alternative alignments.',
    tags: ['strings', 'dynamic-programming', 'optimization'],
    instance: build(makeRng('edit', CFG.n), { length: CFG.length, edits: CFG.edits }),
  }),
];
