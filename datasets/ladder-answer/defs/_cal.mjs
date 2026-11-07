// Family "cal": working days over several years, with fixed-date holidays that move
// off weekends, holidays on the n-th weekday of a month, bridge days, closure
// periods and a quarterly inventory day. The instance is
//   { kind: 'count' | 'nth', from, to | need, fixed: [{ month, day }],
//     nth: [{ month, nth, weekday }], closures: [[from, to]] }
// `nth` is 1 to 4, or -1 for the last weekday of that name in the month.
//
// Two exact methods that share no code:
//   solveScan   goes through the days one by one and asks a yes or no question of each
//   solveSets   builds the sets of days off, subtracts them from a count of weekdays,
//               and finds the n-th working day by bisection on that count
// The shortcut keeps only the first three rules (weekends, the holidays on the
// printed dates, closures) and drops the weekend moves, the bridge days and the
// inventory days.

import { DAY, MONTHS, WEEKDAYS, dateText, toIso, toTime, weekdayOf, list } from './_rng.mjs';

const ORD = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' };
const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// ---- method 1: one day at a time -------------------------------------------------------

function offDatesScan(instance, lo, hi) {
  const off = new Set();
  const holidays = new Set();
  for (let y = lo; y <= hi; y += 1) {
    for (const { month, day } of instance.fixed) {
      const t = toTime(iso(y, month, day));
      const w = weekdayOf(t);
      holidays.add(toIso(w === 6 ? t - DAY : w === 0 ? t + DAY : t));
    }
    for (const { month, nth, weekday } of instance.nth) {
      const first = weekdayOf(toTime(iso(y, month, 1)));
      const firstHit = 1 + ((weekday - first + 7) % 7);
      let day;
      if (nth > 0) day = firstHit + 7 * (nth - 1);
      else {
        day = firstHit;
        while (day + 7 <= daysIn(y, month)) day += 7;
      }
      holidays.add(iso(y, month, day));
    }
  }
  for (const h of holidays) {
    off.add(h);
    const t = toTime(h);
    if (weekdayOf(t) === 2) off.add(toIso(t - DAY));
    if (weekdayOf(t) === 4) off.add(toIso(t + DAY));
  }
  return { off, holidays };
}

function isWorking(instance, off, closed, time) {
  const w = weekdayOf(time);
  if (w === 0 || w === 6) return false;
  const day = toIso(time);
  return !off.has(day) && !closed(time);
}

export function solveScan(instance, { simple = false } = {}) {
  const from = toTime(instance.from);
  const lo = Number(instance.from.slice(0, 4)) - 1;
  const hi = instance.kind === 'count' ? Number(instance.to.slice(0, 4)) + 1 : lo + 8;
  let off;
  if (simple) {
    off = new Set();
    for (let y = lo; y <= hi; y += 1) {
      for (const { month, day } of instance.fixed) off.add(iso(y, month, day));
      for (const h of offDatesScan({ ...instance, fixed: [] }, y, y).holidays) off.add(h);
    }
  } else off = offDatesScan(instance, lo, hi).off;
  const spans = instance.closures.map(([a, b]) => [toTime(a), toTime(b)]);
  const closed = (time) => spans.some(([a, b]) => time >= a && time <= b);
  const base = (time) => isWorking(instance, off, closed, time);
  const working = (time) => {
    if (!base(time)) return false;
    if (simple) return true;
    const month = new Date(time).getUTCMonth() + 1;
    if (month % 3 !== 0) return true;
    for (let t = time + DAY; new Date(t).getUTCMonth() + 1 === month; t += DAY) if (base(t)) return true;
    return false;
  };
  if (instance.kind === 'count') {
    let count = 0;
    for (let t = from; t <= toTime(instance.to); t += DAY) if (working(t)) count += 1;
    return count;
  }
  let done = 0;
  for (let t = from; ; t += DAY) {
    if (working(t) && (done += 1) === instance.need) return toIso(t);
  }
}

// ---- method 2: sets and counting -----------------------------------------------------------

function offDatesSets(instance, lo, hi) {
  const marked = new Set();
  for (let y = lo; y <= hi; y += 1) {
    for (const { month, day } of instance.fixed) {
      const t = toTime(iso(y, month, day));
      const shift = { 6: -1, 0: 1 }[weekdayOf(t)] || 0;
      marked.add(toIso(t + shift * DAY));
    }
    for (const { month, nth, weekday } of instance.nth) {
      const hits = [];
      for (let d = 1; d <= daysIn(y, month); d += 1) if (weekdayOf(toTime(iso(y, month, d))) === weekday) hits.push(d);
      marked.add(iso(y, month, nth > 0 ? hits[nth - 1] : hits.at(-1)));
    }
  }
  const all = new Set(marked);
  for (const day of marked) {
    const w = weekdayOf(toTime(day));
    if (w === 2) all.add(toIso(toTime(day) - DAY));
    else if (w === 4) all.add(toIso(toTime(day) + DAY));
  }
  return all;
}

const weekdaysUpTo = (time) => {
  // Number of Monday to Friday days from a fixed Monday (2000-01-03) up to and including `time`.
  const days = Math.round((time - Date.UTC(2000, 0, 3)) / DAY);
  const weeks = Math.floor(days / 7);
  const rest = days - weeks * 7;
  return weeks * 5 + Math.min(rest + 1, 5);
};

export function solveSets(instance) {
  const lo = Number(instance.from.slice(0, 4)) - 1;
  const hi = instance.kind === 'count' ? Number(instance.to.slice(0, 4)) + 1 : lo + 8;
  const off = offDatesSets(instance, lo, hi);
  for (const [a, b] of instance.closures) for (let t = toTime(a); t <= toTime(b); t += DAY) off.add(toIso(t));
  const isWeekday = (day) => ![0, 6].includes(weekdayOf(toTime(day)));
  const inventory = new Set();
  for (let y = lo; y <= hi; y += 1) {
    for (const m of [3, 6, 9, 12]) {
      for (let d = daysIn(y, m); d >= 1; d -= 1) {
        const day = iso(y, m, d);
        if (isWeekday(day) && !off.has(day)) {
          inventory.add(day);
          break;
        }
      }
    }
  }
  const out = [...off, ...inventory].filter(isWeekday);
  const countTo = (day) => weekdaysUpTo(toTime(day)) - out.filter((x) => x <= day).length;
  const before = weekdaysUpTo(toTime(instance.from) - DAY) - out.filter((x) => x < instance.from).length;
  if (instance.kind === 'count') return countTo(instance.to) - before;
  // The first day whose running count reaches `need` (that day is then a working day).
  let low = toTime(instance.from);
  let high = low + 4000 * DAY;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2 / DAY) * DAY;
    if (countTo(toIso(mid)) - before >= instance.need) high = mid;
    else low = mid + DAY;
  }
  return toIso(low);
}

export function solve(instance) {
  return { answer: solveScan(instance) };
}

export function solveProved(instance) {
  const answer = solveScan(instance);
  if (solveSets(instance) !== answer) throw new Error(`cal: the two methods disagree (${answer} vs ${solveSets(instance)})`);
  return { answer };
}

export function shortcuts(instance) {
  return [{ name: 'weekends, printed holiday dates and closures only', answer: solveScan(instance, { simple: true }) }];
}

// ---- generator -------------------------------------------------------------------------------

export function build(rng, cfg) {
  const { kind, startYear, spanDays, fixedCount, nthCount, closureCount } = cfg;
  return rng.attempt(() => {
    const start = Date.UTC(startYear, 0, rng.int(2, 14));
    const from = toIso(start);
    const to = toIso(start + spanDays * DAY);
    const slots = rng.sample([...Array(12).keys()].map((m) => m + 1), fixedCount + nthCount);
    const fixed = slots.slice(0, fixedCount).map((month) => ({ month, day: rng.int(1, 28) }));
    // One fixed date on 1 or 2 January keeps year-boundary moves in play.
    fixed[0] = { month: 1, day: rng.pick([1, 2]) };
    const nth = slots.slice(fixedCount).map((month) => ({ month, nth: rng.pick([1, 2, 3, 4, -1]), weekday: rng.int(1, 5) }));
    if (new Set(fixed.map((f) => f.month)).size < fixed.length) return null;
    fixed.sort((p, q) => p.month - q.month || p.day - q.day);
    const closures = [];
    for (let k = 0; k < closureCount; k += 1) {
      const a = start + rng.int(40 + k * Math.floor(spanDays / closureCount), 40 + (k + 1) * Math.floor(spanDays / closureCount) - 30) * DAY;
      closures.push([toIso(a), toIso(a + rng.int(5, 15) * DAY)]);
    }
    const instance = { kind, from, ...(kind === 'count' ? { to } : { need: Math.round(spanDays * 0.62) }), fixed, nth: nth.sort((p, q) => p.month - q.month), closures };
    const answer = solveScan(instance);
    const shortcut = solveScan(instance, { simple: true });
    return shortcut !== answer ? instance : null;
  }, 500);
}

// ---- text --------------------------------------------------------------------------------------

export function render(instance) {
  const { fixed, nth, closures, from } = instance;
  const fixedText = (f) => `${f.day} ${MONTHS[f.month - 1]}`;
  const nthText = (h) => `the ${ORD[h.nth]} ${WEEKDAYS[h.weekday]} of ${MONTHS[h.month - 1]}`;
  const head =
    instance.kind === 'count'
      ? `A company wants to know how many working days there are from ${WEEKDAYS[weekdayOf(toTime(from))]} ${dateText(from)} to ${dateText(instance.to)}, both days included.`
      : `A project team starts work on ${WEEKDAYS[weekdayOf(toTime(from))]} ${dateText(from)}. The start date counts if it is a working day. The project needs ${instance.need} working days of work, one day of work per working day.`;
  return [
    head,
    '',
    'Rules (use the real Gregorian calendar):',
    '1. Saturdays and Sundays are not working days.',
    `2. Every year the company has these holidays on fixed dates: ${list(fixed.map(fixedText))}. A fixed-date holiday that falls on a Saturday is taken on the Friday before it, and one that falls on a Sunday is taken on the Monday after it (this can move it into the neighbouring month or year).`,
    `3. Every year the company also has these holidays: ${list(nth.map(nthText))}. These are always taken on the day itself.`,
    '4. Bridge days: when a holiday (as taken after rules 2 and 3) is on a Tuesday, the Monday before it is also a day off; when it is on a Thursday, the Friday after it is also a day off. A bridge day does not create another bridge day.',
    `5. The company is closed for these periods, both end dates included: ${list(closures.map(([a, b]) => `${dateText(a)} to ${dateText(b)}`))}.`,
    '6. After rules 1 to 5 have decided which days are working days, the last such working day in each of March, June, September and December is an inventory day: no project work is done on it and it does not count.',
    '',
    instance.kind === 'count' ? 'How many working days are there in that period? (Inventory days do not count.)' : 'On which date is the last day of work of the project?',
    instance.kind === 'count' ? 'Answer format: a whole number.' : 'Answer format: the date as YYYY-MM-DD.',
  ].join('\n');
}
