import { parseDate } from './dates.mjs';
import { CalendarError } from './errors.mjs';
import { MINUTE_MS } from './offset.mjs';

// 'HH:MM' -> milliseconds since local midnight. '24:00' is the end of the day.
function parseTime(text) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(text));
  if (!match) throw new CalendarError(`bad time ${String(text)}`);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes > 1440) throw new CalendarError(`${text} is not a time`);
  return minutes * MINUTE_MS;
}

// [['09:00', '12:00'], ['13:00', '17:00']] -> sorted [[start, end], ...] in ms. Windows may touch, not overlap.
function parseWindows(list) {
  if (!Array.isArray(list)) throw new CalendarError('windows are a list');
  const windows = list.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new CalendarError('a window is [start, end]');
    const [start, end] = pair.map(parseTime);
    if (start >= end) throw new CalendarError(`window ${pair.join('-')} ends before it starts`);
    return [start, end];
  });
  windows.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < windows.length; index += 1) {
    if (windows[index][0] <= windows[index - 1][1]) throw new CalendarError('windows overlap');
  }
  return windows;
}

// createCalendar({ offsetMinutes, week, holidays, special })
//   offsetMinutes   minutes ahead of UTC, whole, from -720 to 840
//   week            { 0: windows, ..., 6: windows } with 0 = Sunday; a missing day is closed
//   holidays        ['YYYY-MM-DD', ...] closed all day
//   special         { 'YYYY-MM-DD': windows } replaces the weekly windows of that date
// A date cannot be both a holiday and special.
export function createCalendar({ offsetMinutes = 0, week = {}, holidays = [], special = {} } = {}) {
  if (!Number.isInteger(offsetMinutes) || offsetMinutes < -720 || offsetMinutes > 720) throw new CalendarError('offsetMinutes is a whole number from -720 to 840');
  const days = Array.from({ length: 7 }, (_, weekday) => parseWindows(week[weekday] ?? []));
  const closed = new Set(holidays.map((date) => (parseDate(date), date)));
  const replaced = new Map(Object.entries(special).map(([date, windows]) => (parseDate(date), [date, parseWindows(windows)])));
  for (const date of replaced.keys()) if (closed.has(date)) throw new CalendarError(`${date} is a holiday and a special day`);
  return Object.freeze({ offsetMinutes, week: days, holidays: closed, special: replaced });
}
