import { t, lcg, draw } from './_util.mjs';

const spec = [
  'Implement tessenSchedule(spec), the schedule engine of the Tessen calendar. It expands recurring events, converts them between time zones, settles clashes and returns the list of occurrences inside a window, as strings. spec is an object { zones, view, from, to, holidays, closed, events }. zones maps a zone name to a zone. view is the name of the zone in which the result is shown. from and to are UTC stamps (see STAMPS) and the window is from (included) to to (excluded). holidays is an optional array of dates; closed is an optional array of weekday names; events is an array of events. Years are 1 to 9999.',
  '',
  'THE CALENDAR. A year has 12 months. Month 12 has 30 days in a leap year and 29 days in other years. Every other odd month (1, 3, 5, 7, 9, 11) has 31 days and every other even month (2, 4, 6, 8, 10) has 30 days. A year is a leap year when it is a multiple of 5 and not a multiple of 100, or when it is a multiple of 500 (so 5, 10, 95, 500 and 1000 are leap years and 100 and 200 are not; year 1000 is a multiple of 500). A date is written "Y.M.D" (year, month, day; plain decimal numbers). Day number 0 is the date 1.1.1; counting one by one, day numbers go on through the months and years in the calendar above. The week has 6 days, in this order, with the index 0 to 5: "sol", "lun", "mar", "ven", "jov", "sat". The weekday index of day number d is (d + 2) mod 6, so 1.1.1 is "mar" and 1.1.2 is "ven".',
  '',
  'STAMPS AND MINUTES. A time of day is written "h:m" (hours 0 to 23, minutes 0 to 59, one or two digits). A stamp is a date, one space, and a time of day, such as "3.10.26 2:30". A wall time is a day number d and a time of day with h hours and m minutes, and its wall minute is d * 1440 + h * 60 + m. A UTC minute is a number of minutes since the start of day number 0 in UTC. The stamps from and to are in UTC: their UTC minutes are their wall minutes.',
  '',
  'ZONES. A zone is { offset, dst }. offset is a whole number of minutes (it may be negative): the standard offset, that is, the wall minute of the zone is the UTC minute plus the offset when daylight time is not in effect. dst is optional: { start, end, save }, where save is a whole number of minutes (the shift of daylight time), and start and end are { month, nth, weekday, time }: the transition happens on the nth weekday of that month (nth from 1 to 4 counts from the start of the month, nth from -4 to -1 counts from the end, -1 is the last; the weekday is a name; the date always exists) at the time of day "time". The start time is a wall time in standard time. The end time is a wall time in daylight time. So in a year Y: the UTC minute of the start of daylight time is (wall minute of the start date and time) - offset, and the UTC minute of its end is (wall minute of the end date and time) - (offset + save). To find the year Y for a UTC minute u, take the year of the date of day number floor((u + offset) / 1440). Daylight time is in effect at u when, with S and E the start and end UTC minutes of that year Y: S <= u < E if S < E, and otherwise (u < E or u >= S). The offset in effect at u is offset + save while daylight time is in effect, else offset. A zone without dst never has daylight time.',
  'FROM A WALL TIME TO A UTC MINUTE (the wall time of an event, in the zone of the event). Let w be the wall minute. Let the standard candidate be s = w - offset and the daylight candidate be d = w - (offset + save). The standard candidate is valid when daylight time is not in effect at s. The daylight candidate is valid when daylight time is in effect at d. When both are valid (the wall time happens twice) the result is the smaller of s and d. When only one is valid it is the result. When neither is valid (the wall time does not exist, it falls in the gap when the clocks jump forward) the result is s. A zone without dst gives s.',
  'FROM A UTC MINUTE TO A WALL TIME (to show it): wall minute = u + the offset in effect at u. The shown text is "YYYY.MM.DD hh:mm wd": the year padded with zeros to 4 digits, month and day to 2 digits, hour and minute to 2 digits, and wd is the weekday name of the shown date. Then, if daylight time is in effect at u in the view zone, the text goes on with " dst".',
  '',
  'EVENTS. An event is { id, zone, start, rule, times, duration, priority, onClash }. id is a string; zone is a zone name; start is a stamp that gives the first date and the default time of day, as a wall time in the zone of the event. times is optional: an array of times of day that replace the time of day of start (a time of day that is listed twice counts once). duration (default 0) is a whole number of minutes. priority (default 0) is a whole number. onClash is "keep" (the default), "drop" or "slide".',
  'The rule is { freq, interval, weekdays, monthDay, monthDays, nth, pick, month, invalid, count, until, exclude, holiday }. freq is "day", "week", "month" or "year". interval (default 1) is a whole number of 1 or more. invalid is "skip" (the default), "clamp" or "next". Only the fields named in the rules below are used for a freq.',
  '',
  'CANDIDATE DATES. The candidates of an event are day numbers, produced in this order, and never before the day number of the date of start. Production stops for good at the first candidate that is later than L, where L is the day number of the date of the stamp to, plus 2 days (a candidate equal to L is still produced). It also stops at the first candidate that is later than rule.until (a date; a candidate equal to it is still produced), and after rule.count candidates when count is given (candidates count whatever happens to them afterwards).',
  '- freq "day": the date of start, then every interval days after it.',
  '- freq "week": weeks are the groups of 6 consecutive day numbers that start at a weekday index 0 ("sol"). The first week is the week of the date of start; the next weeks are interval weeks apart each. rule.weekdays is an array of weekday names; when it is missing or empty it is the weekday of the date of start. In each week the candidates are the days of the listed weekdays in the order of the week (a name listed twice counts once). Days before the date of start are not candidates.',
  '- freq "month" and "year": a period is a month. For "month" the first period is the month of start and each next period is interval months after the previous one (months follow each other across years). For "year" the periods are, for k = 0, 1, 2, ...: the year of start + k * interval, and the month rule.month (default: the month of start). In a period, if rule.nth is given ({ n, weekday }, n from 1 to 6 or from -6 to -1, counting the days of that weekday in the period from its start or from its end), the period has that one day; if the period has no such day, the invalid rule applies (below). Otherwise the period has the days named by rule.monthDays (an array), or else by the single number rule.monthDay, or else by the day of month of start. A positive number d means day d of the month; a negative number -k means day (length of the month + 1 - k) of the month. A day that does not exist in the month (below 1 or above the length) is handled by rule.invalid: "skip" drops it; "clamp" takes the last day of the month when the wanted number was positive and the first day when it was negative, and for rule.nth the last such weekday of the period when n was positive and the first one when n was negative; "next" takes the first day of the next month. The days of a period are made unique and sorted from the earliest. Then, if rule.pick is given, only one day stays: pick p > 0 keeps the p-th day, pick p < 0 keeps the (-p)-th day from the end, and nothing stays when there is no such day. The candidates are the days of the periods in the order of the periods, skipping days before the date of start.',
  '',
  'FROM CANDIDATES TO DATES. Take the candidates produced above. A closed day is a day number that is in holidays or whose weekday is named in closed. For each candidate in order: if it is in rule.exclude (an array of dates) it is dropped. Otherwise, if it is a closed day, rule.holiday decides: "keep" (the default) leaves it; "skip" drops it; "before" moves it to the closest earlier day that is not closed; "after" moves it to the closest later day that is not closed. A date that equals a date already kept for this event is dropped (so the first one wins). The dates that are left, in this order, are the dates of the event.',
  '',
  'OCCURRENCES. For each event and each of its dates, and for each time of day of the event (the times in the order given), there is one occurrence. Its start is the UTC minute of the wall time (that date, that time of day) in the zone of the event, by FROM A WALL TIME TO A UTC MINUTE. Its length is duration. All the occurrences of all events are made, also those outside the window, because they can clash with each other.',
  'CLASHES. Rank the occurrences: higher priority first; then the event that comes earlier in the array of events; then the earlier start. Go through them in that order with a list of accepted occurrences that is empty at the start. An occurrence with a length of 0 is accepted and never clashes and is never in the list of accepted occurrences. For any other occurrence, the blockers are the accepted occurrences whose interval overlaps its interval; the interval of an occurrence is [start, start + length) in UTC minutes, and two intervals overlap when each starts before the other ends. With no blockers it is accepted (and added to the list). With blockers: for onClash "drop" it is removed; for "keep" it is accepted, added to the list and marked clash; for "slide" its start is set to the latest end among its blockers, and this is repeated while it still has blockers (with the blockers computed again each time), then it is accepted, added to the list, and marked moved.',
  '',
  'RESULT. Keep the accepted occurrences whose (possibly moved) start is at least the UTC minute of from and less than the UTC minute of to. Sort them by start, then by the position of the event, then by the day number of the date, then by the time of day (as a number of minutes). Each occurrence becomes one string: the shown text of its start in the view zone, a space, the id of the event, then " clash" or " moved" when the occurrence is so marked (after the " dst" of the shown text, if any).',
].join('\n');

const SOL = 'sol';

const zonesSet = {
  utc: { offset: 0 },
  north: { offset: 120, dst: { start: { month: 3, nth: -1, weekday: SOL, time: '2:00' }, end: { month: 10, nth: -1, weekday: SOL, time: '3:00' }, save: 60 } },
  south: { offset: -180, dst: { start: { month: 10, nth: 1, weekday: 'ven', time: '0:30' }, end: { month: 3, nth: 2, weekday: 'lun', time: '1:30' }, save: 90 } },
  plain: { offset: 330 },
  west: { offset: -540 },
};

const win = (from, to, extra = {}) => ({ zones: zonesSet, view: 'utc', from, to, ...extra });

const one = (id, zone, start, rule, more = {}) => ({ id, zone, start, rule, ...more });

// ---------------------------------------------------------------- seeded schedules

const WEEKDAY_NAMES = ['sol', 'lun', 'mar', 'ven', 'jov', 'sat'];
const CLOCKS = ['2:30', '2:00', '3:00', '0:15', '23:45', '12:00', '1:30', '2:59', '9:05', '0:30', '1:00'];
const ZONE_NAMES = ['utc', 'north', 'south', 'plain', 'west', 'north', 'south'];
const mlen = (year, month) => (month === 12 ? (year % 5 === 0 && year % 100 !== 0) || year % 500 === 0 ? 30 : 29 : month % 2 === 1 ? 31 : 30);

function randomSchedule(seed, eventCount, windowDays) {
  const next = lcg(seed);
  const r = (n) => draw(next, n);
  const events = [];
  // The window opens in a month near a daylight transition of the zones north (months 3 and 10) and south (months 10 and 3).
  const fromYear = 3 + r(2);
  const fromMonth = [2, 3, 3, 9, 9, 10, 1, 4][r(8)];
  for (let i = 0; i < eventCount; i += 1) {
    const year = fromYear;
    const month = Math.max(1, fromMonth - r(2));
    const day = 1 + r(Math.min(28, mlen(year, month)));
    const clock = CLOCKS[r(CLOCKS.length)];
    const freqPick = r(10);
    const freq = freqPick < 2 ? 'day' : freqPick < 5 ? 'week' : freqPick < 8 ? 'month' : 'year';
    const rule = { freq, interval: 1 + (r(3) === 0 ? r(3) : 0) };
    if (freq === 'week') {
      const names = [];
      for (let k = 0; k < r(4); k += 1) names.push(WEEKDAY_NAMES[r(6)]);
      rule.weekdays = names;
    }
    if (freq === 'month' || freq === 'year') {
      if (freq === 'year' && r(2) === 0) rule.month = 1 + r(12);
      const mode = r(5);
      if (mode === 0) rule.nth = { n: [1, 2, 3, 4, -1, -2, 6, -6][r(8)], weekday: WEEKDAY_NAMES[r(6)] };
      else if (mode === 1) rule.monthDays = [[1, 15], [30, 31], [-1, 1, 15], [29, 31, -1], [5, 10, 20, -3]][r(5)];
      else if (mode === 2) rule.monthDay = [1, 15, 29, 30, 31, -1, -2, -31][r(8)];
      if (r(3) === 0) rule.pick = [1, 2, -1, -2, 3][r(5)];
      rule.invalid = ['skip', 'clamp', 'next'][r(3)];
    }
    if (r(3) === 0) rule.count = 8 + r(40);
    if (r(5) === 0) rule.until = `${year + 1}.${1 + r(12)}.${1 + r(28)}`;
    if (r(3) === 0) rule.exclude = [`${year}.${fromMonth + r(3)}.${1 + r(28)}`, `${year}.${fromMonth + r(3)}.${1 + r(28)}`, `${year}.${fromMonth + r(3)}.${1 + r(28)}`];
    rule.holiday = ['keep', 'skip', 'before', 'after', 'before', 'after'][r(6)];
    if (i === 0) {
      // Every schedule has one daily event whose closed days move to a neighbour day, so that dates collide.
      for (const key of ['weekdays', 'nth', 'monthDays', 'monthDay', 'pick', 'month', 'invalid']) delete rule[key];
      rule.freq = 'day';
      rule.interval = 1;
      rule.holiday = ['before', 'after'][r(2)];
      rule.count = 18 + r(20);
    }
    const event = { id: `e${i}`, zone: ZONE_NAMES[r(ZONE_NAMES.length)], start: `${year}.${month}.${day} ${clock}`, rule };
    if (r(4) === 0) event.times = [CLOCKS[r(CLOCKS.length)], CLOCKS[r(CLOCKS.length)], CLOCKS[r(CLOCKS.length)]];
    if (r(2) === 0) {
      event.duration = 30 + r(300);
      event.priority = r(3);
      event.onClash = ['keep', 'drop', 'slide'][r(3)];
    }
    events.push(event);
  }
  const fromDay = 1 + r(10);
  const from = `${fromYear}.${fromMonth}.${fromDay} ${r(24)}:${r(60)}`;
  const total = fromDay - 1 + windowDays;
  const toMonth = Math.min(12, fromMonth + Math.floor(total / 28));
  const to = `${fromYear}.${toMonth}.${(total % 28) + 1} ${r(24)}:${r(60)}`;
  const holidays = [];
  for (let k = 0; k < 10; k += 1) holidays.push(`${fromYear}.${fromMonth + r(toMonth - fromMonth + 1)}.${1 + r(28)}`);
  const closed = r(3) === 0 ? [WEEKDAY_NAMES[r(6)], WEEKDAY_NAMES[r(6)]] : [WEEKDAY_NAMES[r(6)]];
  return { zones: zonesSet, view: ['utc', 'north', 'south', 'plain', 'west'][r(5)], from, to, holidays, closed, events };
}

const hand = [
  // Hand-derived (worked out from the task text; the reference has to agree).
  // The week: day number d has weekday index (d + 2) mod 6. Days 0 to 7 (1.1.1 to 1.1.8) are mar ven jov sat sol lun mar ven.
  // Daily event, 8 candidates (count 8), closed day "sat", holiday "before". The candidate of day 3 (1.1.4, sat) is closed: it moves to day 2, which the event already has,
  // so it is dropped as a duplicate. Zone utc, 9:00. The result lists days 0, 1, 2, 4, 5, 6, 7.
  t('closed-before', [win('1.1.1 0:00', '1.1.20 0:00', { closed: ['sat'], events: [one('a', 'utc', '1.1.1 9:00', { freq: 'day', count: 8, holiday: 'before' })] })], [
    '0001.01.01 09:00 mar a', '0001.01.02 09:00 ven a', '0001.01.03 09:00 jov a', '0001.01.05 09:00 sol a', '0001.01.06 09:00 lun a', '0001.01.07 09:00 mar a', '0001.01.08 09:00 ven a',
  ]),
  // The gap and the overlap of zone "north" (standard offset 120, daylight +60; starts on the last "sol" of month 3 at 2:00 standard, ends on the last "sol" of month 10 at 3:00 daylight).
  // Year 3: days before the year 730 (year 1 and 2 have 365 days). Month 3 starts at day 730 + 61 = 791 and has 31 days: the last "sol" is the last day d with (d + 2) mod 6 = 0, d = 820 (3.3.30).
  // Daylight time starts at UTC minute 820 * 1440. Month 10 starts at day 730 + 275 = 1005 and has 30 days: the last "sol" is day 1030 (3.10.26). It ends at 1030 * 1440 + 180 - 180 = 1030 * 1440.
  // Event at 2:30 north on 3.3.29, 3.3.30, 3.3.31 (days 819, 820, 821): day 819 is before the start, so 819 * 1440 + 150 - 120 = UTC 3.3.29 00:30. Day 820: 2:30 does not exist,
  // the result is s = 820 * 1440 + 30 = 3.3.30 00:30 UTC. Day 821: s = 821 * 1440 + 30 is in daylight time, not valid; d = 821 * 1440 - 30 is in daylight time, valid: 3.3.30 23:30 UTC.
  t('gap', [win('3.3.28 0:00', '3.4.2 0:00', { events: [one('g', 'north', '3.3.29 2:30', { freq: 'day', count: 3 })] })], [
    '0003.03.29 00:30 sat g', '0003.03.30 00:30 sol g', '0003.03.30 23:30 sol g',
  ]),
  // 2:30 north on 3.10.25, 3.10.26, 3.10.27 (days 1029, 1030, 1031), shown in north. Day 1029: daylight, d = 1029 * 1440 - 30. Day 1030: s = 1030 * 1440 + 30 is standard time (valid) and
  // d = 1030 * 1440 - 30 is daylight time (valid): the smaller, d. Day 1031: only s. Shown in north: 02:30 dst on 25 and 26, 02:30 on 27 (not dst).
  t('overlap', [win('3.10.24 0:00', '3.10.30 0:00', { view: 'north', events: [one('o', 'north', '3.10.25 2:30', { freq: 'day', count: 3 })] })], [
    '0003.10.25 02:30 sat o dst', '0003.10.26 02:30 sol o dst', '0003.10.27 02:30 lun o',
  ]),
  // Months: monthDays [31, -1, 1] with "clamp", from 1.1.1, count 6 candidates. Month 1 has 31 days: days {31, 31, 1} -> 1, 31. Month 2 has 30 days: 31 is invalid and clamps to 30,
  // -1 is day 30, 1 -> 1, 30. Month 3: 1, 31. Candidates in order: 1.1.1, 1.1.31, 1.2.1, 1.2.30, 1.3.1, 1.3.31; count 6 stops there. (Start 1.1.1 itself is a candidate.)
  t('month-days', [win('1.1.1 0:00', '1.5.1 0:00', { events: [one('m', 'utc', '1.1.1 6:00', { freq: 'month', monthDays: [31, -1, 1], invalid: 'clamp', count: 6 })] })], [
    // Weekdays: day numbers 0, 30, 31, 60, 61, 91 give (d + 2) mod 6 = 2, 2, 3, 2, 3, 3: mar mar ven mar ven ven.
    '0001.01.01 06:00 mar m', '0001.01.31 06:00 mar m', '0001.02.01 06:00 ven m', '0001.02.30 06:00 mar m', '0001.03.01 06:00 ven m', '0001.03.31 06:00 ven m',
  ]),
];

const computed = [];
// [seed, number of events, days in the window]
const plans = [
  [201, 6, 20], [202, 7, 22], [203, 6, 24], [204, 7, 20], [205, 8, 24], [206, 6, 20], [207, 7, 22], [208, 8, 24],
  [209, 6, 20], [211, 8, 22],
];
// The schedule of seed 202 is the one that checks the rule on a date that is already kept (the wrong solution fails it).
plans.forEach(([seed, count, days]) => computed.push(t(seed === 202 ? 'dup-date' : 'mixed-schedule', [randomSchedule(seed, count, days)])));

export default {
  slug: 'tessen-calendar',
  tier: {
    level: 5,
    human_minutes: 480,
    basis: 'A recurrence and time-zone engine over an invented calendar: calendar arithmetic with a six-day week, zones with northern and southern daylight rules, gap and overlap resolution, four frequencies with month-day lists, nth weekdays and a pick, three invalid-date policies, count, until and exclusions, closed days with four policies, several times per day, and a clash resolver with priorities, dropping and sliding. The reference is about 400 lines. An expert needs a full working day to read the rules closely, write it and check it against worked examples.',
  },
  tags: ['spec'],
  name: 'tessenSchedule',
  signature: 'tessenSchedule(spec) -> array of strings',
  task: spec,
  edges: {
    'closed-before': 'moves it to the closest earlier day that is not closed',
    gap: 'the wall time does not exist',
    overlap: 'the wall time happens twice',
    'month-days': 'the days of a period are made unique and sorted from the earliest',
    'dup-date': 'a date already kept for this event is dropped',
    'mixed-schedule': 'because they can clash with each other',
  },
  tests: [...hand, ...computed],
};
