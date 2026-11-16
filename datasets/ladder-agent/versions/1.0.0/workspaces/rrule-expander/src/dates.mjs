// Calendar helpers (proleptic Gregorian, UTC). A *day number* counts days from 1970-01-01, which is day 0.
// SPEC.md section 1 says which years are valid.
export const MIN_YEAR = 1970;
export const MAX_YEAR = 2999;
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Day number of a calendar date; month is 1 to 12. */
export function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The calendar date { year, month, day } of a day number. */
export function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** The weekday of a day number as an index into WEEKDAYS: 0 is Monday, 6 is Sunday. 1970-01-01 was a Thursday. */
export function weekdayOf(days) {
  return (((days + 3) % 7) + 7) % 7;
}

/**
 * Reads the basic ISO form: `YYYYMMDDTHHMMSSZ` (or `YYYYMMDD` when dateOnly is true). Returns
 * { days, seconds } (seconds since midnight; 0 for a date), or null when the text is not a real date and time
 * in the years MIN_YEAR to MAX_YEAR.
 */
export function readBasic(text, dateOnly = false) {
  const m = dateOnly ? /^(\d{4})(\d{2})(\d{2})$/.exec(text) : /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map((part) => (part === undefined ? 0 : Number(part)));
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { days: daysFromCivil(year, month, day), seconds: hour * 3600 + minute * 60 + second };
}

/** The text `YYYYMMDDTHHMMSSZ` of a day number and seconds since midnight. */
export function formatBasic(days, seconds) {
  const { year, month, day } = civilFromDays(days);
  const pad = (n, width) => String(n).padStart(width, '0');
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  return `${pad(year, 4)}${pad(month, 2)}${pad(day, 2)}T${pad(hour, 2)}${pad(minute, 2)}${pad(seconds % 60, 2)}Z`;
}
