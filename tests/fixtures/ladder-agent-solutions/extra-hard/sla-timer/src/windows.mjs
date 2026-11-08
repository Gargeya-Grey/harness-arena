import { dateOfDay, weekdayOfDay } from './dates.mjs';

// The open windows of local day `day` as [start, end] in ms since that day began.
export function windowsOfDay(calendar, day) {
  const date = dateOfDay(day);
  if (calendar.holidays.has(date)) return [];
  if (calendar.special.has(date)) return calendar.special.get(date);
  return calendar.week[weekdayOfDay(day)];
}
