import { CalendarError } from './errors.mjs';

const DAY_MS = 86_400_000;
const pad = (number, width = 2) => String(number).padStart(width, '0');

export const formatDate = (year, month, day) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

// 'YYYY-MM-DD' -> { year, month, day }. Throws CalendarError for text that is not a real date from the year 1000 on.
export function parseDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text));
  if (!match) throw new CalendarError(`bad date ${String(text)}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new CalendarError(`${text} is not a date`);
  }
  return { year, month, day };
}

// Civil days counted from 1970-01-01, which is day 0.
export const dayNumber = ({ year, month, day }) => Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);

export function dateOfDay(number) {
  const date = new Date(number * DAY_MS);
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

// 0 is Sunday. 1970-01-01 was a Thursday.
export const weekdayOfDay = (number) => (((number + 4) % 7) + 7) % 7;
