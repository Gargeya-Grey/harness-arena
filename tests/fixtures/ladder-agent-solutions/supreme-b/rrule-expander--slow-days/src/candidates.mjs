import { WEEKDAYS, civilFromDays, daysFromCivil, daysInMonth, isLeapYear, weekdayOf } from './dates.mjs';

/**
 * The BY parts that apply to a rule once the defaults of SPEC.md section 5.1 are filled in. The defaults come
 * from DTSTART and only fill a part the rule leaves empty.
 */
export function effectiveParts(rule, startDay) {
  const start = civilFromDays(startDay);
  let { bymonth, bymonthday, byday } = rule;
  if (rule.freq === 'WEEKLY' && !byday.length) byday = [{ ordinal: 0, day: WEEKDAYS[weekdayOf(startDay)] }];
  if (rule.freq === 'MONTHLY' && !bymonthday.length && !byday.length) bymonthday = [start.day];
  if (rule.freq === 'YEARLY' && !bymonthday.length && !byday.length) {
    bymonthday = [start.day];
    if (!bymonth.length) bymonth = [start.month];
  }
  return { bymonth, bymonthday, byday: byday.map((entry) => ({ ordinal: entry.ordinal, weekday: WEEKDAYS.indexOf(entry.day) })) };
}

/** A day number, normalised through its ISO date text. */
function viaText(day) {
  const text = new Date(day * 86400000).toISOString().slice(0, 10);
  const [year, month, dom] = text.split('-').map(Number);
  return Date.UTC(year, month - 1, dom) / 86400000;
}

/** The first and last day number of period number k (0 for the period of DTSTART). */
export function periodAt(rule, startDay, k) {
  const step = rule.interval * k;
  if (rule.freq === 'DAILY') {
    const day = startDay + step;
    return { first: viaText(day), last: viaText(day) };
  }
  if (rule.freq === 'WEEKLY') {
    const back = (weekdayOf(startDay) - WEEKDAYS.indexOf(rule.wkst) + 7) % 7;
    const first = startDay - back + 7 * step;
    return { first, last: first + 6 };
  }
  const start = civilFromDays(startDay);
  if (rule.freq === 'MONTHLY') {
    const index = start.year * 12 + start.month - 1 + step;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const first = daysFromCivil(year, month, 1);
    return { first, last: first + daysInMonth(year, month) - 1 };
  }
  const year = start.year + step;
  const first = daysFromCivil(year, 1, 1);
  return { first, last: first + (isLeapYear(year) ? 365 : 364) };
}

function matches(rule, parts, day) {
  const { year, month, day: dom } = civilFromDays(day);
  if (parts.bymonth.length && !parts.bymonth.includes(month)) return false;
  const dim = daysInMonth(year, month);
  if (parts.bymonthday.length && !parts.bymonthday.some((value) => (value > 0 ? value === dom : dim + value + 1 === dom))) return false;
  if (parts.byday.length) {
    const weekday = weekdayOf(day);
    const inMonth = rule.freq === 'MONTHLY' || (rule.freq === 'YEARLY' && rule.bymonth.length > 0);
    let fromStart;
    let fromEnd;
    if (inMonth) {
      fromStart = Math.ceil(dom / 7);
      fromEnd = -Math.ceil((dim - dom + 1) / 7);
    } else {
      const doy = day - daysFromCivil(year, 1, 1) + 1;
      fromStart = Math.ceil(doy / 7);
      fromEnd = -Math.ceil(((isLeapYear(year) ? 366 : 365) - doy + 1) / 7);
    }
    const hit = parts.byday.some((entry) => entry.weekday === weekday && (entry.ordinal === 0 || entry.ordinal === fromStart || entry.ordinal === fromEnd));
    if (!hit) return false;
  }
  return true;
}

/** The days of one period that the rule selects, ascending, after BYSETPOS. Days before DTSTART are still in it. */
export function candidateDays(rule, parts, period) {
  const days = [];
  for (let day = period.first; day <= period.last; day += 1) if (matches(rule, parts, day)) days.push(day);
  if (!rule.bysetpos.length) return days;
  const picked = new Set();
  for (const position of rule.bysetpos) {
    const day = position > 0 ? days[position - 1] : days[days.length + position];
    if (day !== undefined) picked.add(day);
  }
  return [...picked].sort((a, b) => a - b);
}
