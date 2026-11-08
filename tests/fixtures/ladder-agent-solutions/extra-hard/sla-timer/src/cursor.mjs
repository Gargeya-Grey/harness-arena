import { CalendarError } from './errors.mjs';
import { localDay, localMidnight } from './offset.mjs';
import { windowsOfDay } from './windows.mjs';

const LIMIT_DAYS = 3660;

// The open windows from instant `from` on, as absolute [start, end) pairs. The first one is cut at `from`.
// Windows that are empty after the cut are skipped. Stops after ten years.
export function* openWindows(calendar, from) {
  const first = localDay(from, calendar.offsetMinutes);
  for (let day = first; day < first + LIMIT_DAYS; day += 1) {
    const base = localMidnight(day, calendar.offsetMinutes);
    for (const [windowStart, windowEnd] of windowsOfDay(calendar, day)) {
      const start = Math.max(base + windowStart, from);
      const end = base + windowEnd;
      if (end > start) yield [start, end];
    }
  }
}

// The first instant at or after `ms` that is open. `ms` itself if it is open; the end of a window is closed.
export function nextOpen(calendar, ms) {
  for (const [start] of openWindows(calendar, ms)) return start;
  throw new CalendarError('the calendar is never open');
}
