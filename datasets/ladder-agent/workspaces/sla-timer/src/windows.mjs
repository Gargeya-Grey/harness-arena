import { dateOfDay, weekdayOfDay } from './dates.mjs';

// The open windows of local day `day` as [start, end] in ms since that day began.
export function windowsOfDay(calendar, day) {
  const date = dateOfDay(day);
  if (calendar.holidays.has(date)) return [];
  const special = calendar.special.get(date);
  if (special && special.length > 0) return special;
  return calendar.week[weekdayOfDay(day)];
}
