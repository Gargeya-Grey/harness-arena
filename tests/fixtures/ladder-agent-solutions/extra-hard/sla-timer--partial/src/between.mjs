import { openWindows } from './cursor.mjs';

// The open time, in ms, in the span from `from` up to `to`.
export function businessTimeBetween(calendar, from, to) {
  if (to < from) throw new RangeError('to is before from');
  let total = 0;
  for (const [start, end] of openWindows(calendar, from)) {
    if (start >= to) break;
    total += Math.min(end, to) - start;
  }
  return total;
}
