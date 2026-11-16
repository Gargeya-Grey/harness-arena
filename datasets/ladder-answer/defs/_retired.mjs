// Tasks that left the suite (lab/lib/ladder.mjs loadRetired). Each keeps its definition, so its
// slug stays taken and its proofs keep running; bringing one back is deleting its line here.
//
// Historical rationale below uses a superseded score-band policy. Current policy in
// docs/difficulty.md uses expert time only; model pass rates do not move or retire a task.
// The old rule reference and bands are retained as history, not current acceptance rules.
//
// Suite 2.0.0 (calibration round 2, 8 Nov 2026): the pilot-1 panel (Claude Haiku, Claude Opus,
// DeepSeek and Codex at low effort, one repeat, suite 1.0.0) solved these tier 4 and 5 tasks far
// above their tier's band (extra-hard 0.10 to 0.45, supreme at most 0.2), and their expert time is
// too long for a lower tier (docs/difficulty.md, Calibration rule 3). New exact-optimisation tasks
// (defs/round2/) take their slots. The mean after each slug is the pilot-1 panel mean.
const tooEasy = (mean, tier) => `Pilot 1 (suite 1.0.0): panel mean ${mean}, far above the ${tier} band; too long for a lower tier. Replaced in 2.0.0.`;

export default {
  'grid-six-1': tooEasy(0.75, 'extra-hard'),
  'grid-six-2': tooEasy(1.0, 'extra-hard'),
  'rook-assignment-1': 'Pilot 1 (suite 1.0.0): panel mean 0.50, just above the extra-hard band; the new tier-4 tasks took the slots in 2.0.0. A first candidate to come back.',
  'schedule-three-workers-1': tooEasy(0.75, 'extra-hard'),
  'schedule-three-workers-2': tooEasy(0.75, 'extra-hard'),
  'square-congruence-1': tooEasy(0.75, 'extra-hard'),
  'calendar-years-1': tooEasy(0.75, 'supreme'),
  'calendar-years-2': tooEasy(0.75, 'supreme'),
  'grid-seven-1': tooEasy(1.0, 'supreme'),
  'grid-seven-2': tooEasy(0.75, 'supreme'),
  'route-thirteen-towns': tooEasy(0.5, 'supreme'),
  'word-count-1': tooEasy(0.75, 'supreme'),
  'word-count-2': tooEasy(0.5, 'supreme'),
  'box-shipping-thirteen-parcels': 'Difficulty review (suite 2.0.0): the capacity-price lower bound equals the optimum 48, contrary to the search-heavy proof premise. Replaced by box-shipping-conflict-thirteen in 3.0.0; no human timing was measured.',
  'box-shipping-seventeen-parcels': 'Difficulty review (suite 2.0.0): the capacity-price lower bound equals the optimum 66, contrary to the search-heavy proof premise. Replaced by box-shipping-conflict-seventeen in 3.0.0; no human timing was measured.',
  'building-fourteen-tasks': 'Difficulty review (suite 2.0.0): eight pairwise driver-incompatible tasks certify the optimum 41, contrary to the long infeasibility-proof premise. Replaced by building-resource-fourteen in 3.0.0; no human timing was measured.',
};
