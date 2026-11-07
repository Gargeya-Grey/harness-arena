import { SEED, makeRng } from '../_rng.mjs';
import { build } from '../_cal.mjs';
import { definition } from '../_families.mjs';

// Working days across about three and a half years: ten holidays a year (six on fixed
// dates that move off weekends, four on the n-th weekday of a month), bridge days, four
// closure periods and an inventory day every quarter. The first asks for a count, the
// second for the date of the 806th working day.
const CONFIGS = [
  { kind: 'count', startYear: 2027, spanDays: 1280, fixedCount: 6, nthCount: 4, closureCount: 4 },
  { kind: 'nth', startYear: 2028, spanDays: 1300, fixedCount: 6, nthCount: 4, closureCount: 4 },
];
const MINUTES = [150, 170];

export default () =>
  CONFIGS.map((cfg, i) => {
    const instance = build(makeRng('cal', i + 1), cfg);
    return definition({
      family: 'cal',
      seed: SEED,
      slug: `calendar-years-${i + 1}`,
      level: 5,
      minutes: MINUTES[i],
      basis: 'Estimate, not timed: about 35 holiday dates to place on a weekday and move, the bridge days they cause, four closures that overlap some of them, 14 quarterly inventory days, and a weekday count over three and a half years; each part is checked twice.',
      tags: ['dates', 'multi-step', 'counting'],
      instance,
    });
  });
