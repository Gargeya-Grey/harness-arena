import { addBusinessTime } from './add.mjs';
import { businessTimeBetween } from './between.mjs';
import { SlaError } from './errors.mjs';
import { runningSpans } from './timeline.mjs';

// The instant at which the open time of the spans reached `target`: in the past if it was reached already,
// ahead of `now` if the clock still runs, null if it is stopped or paused short of the target.
function reachedAt(calendar, spans, target, state, now) {
  let done = 0;
  for (const [from, to] of spans) {
    const part = businessTimeBetween(calendar, from, to);
    if (done + part >= target) return addBusinessTime(calendar, from, target - done);
    done += part;
  }
  return state === 'running' ? addBusinessTime(calendar, now, target - done) : null;
}

// computeSla({ calendar, target, events, now, warnPercent = 80 })
//   target       open time allowed, in ms, a whole number of at least 1
//   -> { state, elapsed, remaining, breached, atRisk, deadline }
// breached: elapsed is more than the target (equal is on time). atRisk: not breached and elapsed is at least
// warnPercent percent of the target.
export function computeSla({ calendar, target, events, now, warnPercent = 80 }) {
  if (!Number.isInteger(target) || target < 1) throw new SlaError('target is a whole number of at least 1');
  if (!(warnPercent > 0 && warnPercent <= 100)) throw new SlaError('warnPercent is above 0 and at most 100');
  const { spans, state } = runningSpans(events, now);
  const elapsed = spans.reduce((sum, [from, to]) => sum + businessTimeBetween(calendar, from, to), 0);
  const breached = elapsed > target;
  return {
    state,
    elapsed,
    remaining: target - elapsed,
    breached,
    atRisk: !breached && elapsed * 100 >= target * warnPercent,
    deadline: reachedAt(calendar, spans, target, state, now),
  };
}
