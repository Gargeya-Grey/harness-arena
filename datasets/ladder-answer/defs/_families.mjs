// One uniform face for the new families, used by the definitions and by the tests.
//   render(instance)                 the question text
//   solve(instance)                  { answer } from the exact method; throws when the family's
//                                    proofs fail (answer not unique, methods disagree)
//   shortcutMiss(instance, answer)   the share of tempting shortcuts that miss the answer
//   shortcuts(instance)              what each shortcut answers, kept in the case metadata
// A shortcut that gets stuck, or leaves the answer open, counts as a miss.

import * as grid from './_grid.mjs';
import * as sched from './_sched.mjs';
import * as assign from './_assign.mjs';
import * as congsq from './_congsq.mjs';
import * as seqdp from './_seqdp.mjs';
import * as tour from './_tour.mjs';
import * as cal from './_cal.mjs';
import * as optJobs from './_opt-jobs.mjs';
import * as optPack from './_opt-pack.mjs';
import * as optCover from './_opt-cover.mjs';
import * as optBinpack from './_opt-binpack.mjs';
import * as optSteiner from './_opt-steiner.mjs';
import * as optEdit from './_opt-edit.mjs';
import * as optRcpsp from './_opt-rcpsp.mjs';

const listFamily = (module) => ({
  render: module.render,
  solve: module.solveProved,
  shortcuts: module.shortcuts,
  shortcutMiss: (instance, answer) => {
    const list = module.shortcuts(instance);
    return list.filter((s) => s.answer !== answer).length / list.length;
  },
});

export const FAMILIES = {
  // The shortcut of a logic grid is to skip a clue. The share is the part of the
  // clues whose removal leaves the asked item open (two seatings fit, with different answers).
  grid: {
    render: grid.render,
    solve: (instance) => {
      const found = grid.solve(instance);
      if (found.solutions !== 1) throw new Error(`grid: ${found.solutions} seatings fit the clues`);
      return { answer: found.answer };
    },
    shortcuts: (instance) => [{ name: 'ignore one clue', open_share: Number(grid.ambiguityShare(instance).toFixed(3)) }],
    shortcutMiss: (instance) => grid.ambiguityShare(instance),
  },
  sched3: listFamily(sched),
  assign: listFamily(assign),
  congsq: listFamily(congsq),
  seqdp: listFamily(seqdp),
  tour: listFamily(tour),
  cal: listFamily(cal),
  // Round 2: exact optimisation of one stated instance (see defs/round2/ and _opt-*.mjs).
  jobs: listFamily(optJobs),
  pack: listFamily(optPack),
  cover: listFamily(optCover),
  binpack: listFamily(optBinpack),
  steiner: listFamily(optSteiner),
  edit: listFamily(optEdit),
  rcpsp: listFamily(optRcpsp),
};

/** A ladder definition for one generated instance; the answer comes from the family's exact method. */
export function definition({ family, seed, slug, level, minutes, basis, tags, instance }) {
  const f = FAMILIES[family];
  const { answer } = f.solve(instance);
  return {
    slug,
    tier: { level, human_minutes: minutes, basis },
    tags,
    question: f.render(instance),
    answer,
    metadata: { family, seed, instance, shortcuts: f.shortcuts(instance) },
  };
}
