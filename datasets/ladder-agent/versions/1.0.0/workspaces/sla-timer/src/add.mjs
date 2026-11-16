import { CalendarError } from './errors.mjs';
import { openWindows } from './cursor.mjs';

export function requireDuration(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} is a whole number of milliseconds, 0 or more`);
  return value;
}

// The instant at which `duration` ms of open time have passed since `start`.
// Time spent while closed does not count. 0 gives `start` itself. When the time runs out exactly at the end
// of a window, that end is the answer; it is not moved to the next opening.
export function addBusinessTime(calendar, start, duration) {
  requireDuration(duration, 'duration');
  if (duration === 0) return start;
  let left = duration;
  for (const [windowStart, windowEnd] of openWindows(calendar, start)) {
    if (left < windowEnd - windowStart) return windowStart + left;
    left -= windowEnd - windowStart;
  }
  throw new CalendarError('the calendar is never open');
}
