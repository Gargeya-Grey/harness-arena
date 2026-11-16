// Tasks that left the suite (lab/lib/ladder.mjs loadRetired). Each keeps its definition and its
// reference, wrong and naive solutions, so its slug stays taken and its proofs keep running;
// bringing one back is deleting its line here.
//
// Historical rationale below uses a superseded score-band policy. Current policy in
// docs/difficulty.md uses expert time only; model pass rates do not move or retire a task.
// The old rule reference and bands are retained as history, not current acceptance rules.
//
// Suite 2.0.0 (calibration round 2, 8 Nov 2026): the pilot-1 panel (Claude Haiku, Claude Opus,
// DeepSeek and Codex at low effort, one repeat, suite 1.0.0) solved these tier 4 and 5 tasks far
// above their tier's band (extra-hard 0.10 to 0.45, supreme at most 0.2); Opus solved every one.
// New tasks take their slots: defs/extra-hard-b/ (tier 4), defs/supreme-b/ and defs/supreme-c/
// (tier 5). The mean in each reason is the pilot-1 panel mean.
const tooEasy = (mean, tier) => `Pilot 1 (suite 1.0.0): panel mean ${mean}, far above the ${tier} band. Replaced in 2.0.0.`;
const hardBand = (mean, tier) => `Pilot 1 (suite 1.0.0): panel mean ${mean}, above the ${tier} band and inside the hard band, but its expert time is too long for tier 3 (docs/difficulty.md, Calibration rule 3). Replaced in 2.0.0.`;

export default {
  'convex-clip': 'Pilot 1 (suite 1.0.0): panel mean 0.75, inside the hard band, and its 60 minutes are within a factor of 4 of tier 3; the tier-3 slots stayed with the old tier-3 tasks in 2.0.0. A first candidate to come back.',
  'expr-positions': tooEasy(1.0, 'extra-hard'),
  'forbidden-strings': tooEasy(0.99, 'extra-hard'),
  'gated-routes': tooEasy(0.93, 'extra-hard'),
  'lazy-range-ops': tooEasy(0.85, 'extra-hard'),
  'online-kth': tooEasy(1.0, 'extra-hard'),
  'preemptive-cpus': tooEasy(1.0, 'extra-hard'),
  'balanced-layout': tooEasy(1.0, 'supreme'),
  'binomial-composite-mod': tooEasy(0.95, 'supreme'),
  'fee-partition-cost': hardBand(0.63, 'supreme'),
  'lumen-interpreter': tooEasy(0.99, 'supreme'),
  'offer-lifetimes': hardBand(0.57, 'supreme'),
  'parse-counter': tooEasy(0.95, 'supreme'),
  'partition-valid-groups': hardBand(0.65, 'supreme'),
  'shared-substrings': hardBand(0.75, 'supreme'),
  'sheet-engine': hardBand(0.67, 'supreme'),
  'tree-path-ops': tooEasy(0.89, 'supreme'),
};
