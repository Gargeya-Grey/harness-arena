// Hidden probes for ladder-agent-sla-timer; expected.json holds the answers.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return error.constructor.name;
  }
};
const HOUR = 3_600_000;
const MIN = 60_000;
const at = (text) => Date.parse(`${text}Z`);
const iso = (ms) => (ms === null ? null : new Date(ms).toISOString().replace('.000Z', 'Z'));
const week = (windows, days = [1, 2, 3, 4, 5]) => Object.fromEntries(days.map((day) => [day, windows]));
const OFFICE = [['09:00', '12:00'], ['13:00', '17:00']];
const DAY = [['09:00', '17:00']];
const ev = (type, text) => ({ type, at: at(text) });
const minutes = (ms) => (ms === null ? null : ms / MIN);

const make = async (load, options) => (await lib(load)).createCalendar(options);
const office = (load, extra = {}) => make(load, { week: week(OFFICE), ...extra });
const day = (load, extra = {}) => make(load, { week: week(DAY), ...extra });
const sla = async (load, input) => {
  const { computeSla } = await lib(load);
  return attempt(() => {
    const result = computeSla(input);
    return { state: result.state, elapsed: minutes(result.elapsed), remaining: minutes(result.remaining), breached: result.breached, atRisk: result.atRisk, deadline: iso(result.deadline) };
  });
};
const valid = async (load, options) => {
  const { createCalendar } = await lib(load);
  return attempt(() => (createCalendar(options), 'ok'));
};

export const probes = [
  {
    name: 'keeps the plain office week at offset 0, with a night shift over midnight',
    run: async ({ load }) => {
      const { addBusinessTime, businessTimeBetween, nextOpen } = await lib(load);
      const cal = await office(load);
      const night = await make(load, { week: { 1: [['22:00', '24:00']], 2: [['00:00', '06:00']] } });
      return [
        iso(addBusinessTime(cal, at('2024-03-04T09:30:00'), 2 * HOUR)),
        iso(addBusinessTime(cal, at('2024-03-04T11:00:00'), 2 * HOUR)),
        iso(addBusinessTime(cal, at('2024-03-08T16:00:00'), 2 * HOUR)),
        iso(addBusinessTime(cal, at('2024-03-09T12:00:00'), HOUR)),
        iso(addBusinessTime(cal, at('2024-03-04T12:00:00'), HOUR)),
        businessTimeBetween(cal, at('2024-03-04T10:00:00'), at('2024-03-05T10:00:00')) / HOUR,
        iso(nextOpen(cal, at('2024-03-04T10:00:00'))),
        iso(nextOpen(cal, at('2024-03-04T12:30:00'))),
        iso(addBusinessTime(night, at('2024-03-04T22:00:00'), 4 * HOUR)),
        iso(nextOpen(cal, at('2023-12-30T12:00:00'))),
      ];
    },
  },
  {
    name: 'the hours of a calendar follow its offset, east and west of UTC',
    run: async ({ load }) => {
      const { addBusinessTime, nextOpen } = await lib(load);
      const east = await day(load, { offsetMinutes: 330 });
      const west = await day(load, { offsetMinutes: -300 });
      const far = await day(load, { offsetMinutes: 840 });
      return [
        iso(addBusinessTime(east, at('2024-03-04T00:00:00'), 2 * HOUR)),
        iso(addBusinessTime(east, at('2024-03-04T10:00:00'), 3 * HOUR)),
        iso(nextOpen(east, at('2024-03-04T11:30:00'))),
        iso(addBusinessTime(west, at('2024-03-04T13:00:00'), HOUR)),
        iso(nextOpen(west, at('2024-03-04T22:00:00'))),
        iso(nextOpen(far, at('2024-03-04T00:00:00'))),
        iso(addBusinessTime(far, at('2024-03-04T00:00:00'), 4 * HOUR)),
      ];
    },
  },
  {
    name: 'the weekday, the holidays and the special days are those of the local date',
    run: async ({ load }) => {
      const { nextOpen } = await lib(load);
      const east = await day(load, { offsetMinutes: 600, holidays: ['2024-03-04'], special: { '2024-03-09': [['10:00', '12:00']] } });
      const west = await day(load, { offsetMinutes: -480, holidays: ['2024-03-04'] });
      return [
        iso(nextOpen(east, at('2024-03-03T20:00:00'))),
        iso(nextOpen(east, at('2024-03-03T10:00:00'))),
        iso(nextOpen(east, at('2024-03-08T12:00:00'))),
        iso(nextOpen(west, at('2024-03-04T17:00:00'))),
        iso(nextOpen(west, at('2024-03-04T07:59:00'))),
      ];
    },
  },
  {
    name: 'a duration that is used up exactly at the end of a window ends there',
    run: async ({ load }) => {
      const { addBusinessTime } = await lib(load);
      const cal = await office(load);
      return [
        iso(addBusinessTime(cal, at('2024-03-04T16:00:00'), HOUR)),
        iso(addBusinessTime(cal, at('2024-03-04T11:00:00'), HOUR)),
        iso(addBusinessTime(cal, at('2024-03-04T09:00:00'), 3 * HOUR)),
        iso(addBusinessTime(cal, at('2024-03-08T16:00:00'), HOUR)),
        iso(addBusinessTime(cal, at('2024-03-04T09:00:00'), 7 * HOUR)),
        iso(addBusinessTime(cal, at('2024-03-04T09:00:00'), 7 * HOUR + 1)),
      ];
    },
  },
  {
    name: 'the end of a window is closed, so nextOpen from there goes to the next opening',
    run: async ({ load }) => {
      const { nextOpen } = await lib(load);
      const cal = await office(load);
      return [
        iso(nextOpen(cal, at('2024-03-04T12:00:00'))),
        iso(nextOpen(cal, at('2024-03-04T17:00:00'))),
        iso(nextOpen(cal, at('2024-03-08T17:00:00'))),
        iso(nextOpen(cal, at('2024-03-04T09:00:00'))),
        iso(nextOpen(cal, at('2024-03-04T16:59:59'))),
      ];
    },
  },
  {
    name: 'keeps a duration of 0 and the refusal of a duration that is not a whole number',
    run: async ({ load }) => {
      const { addBusinessTime } = await lib(load);
      const cal = await office(load);
      return [
        iso(addBusinessTime(cal, at('2024-03-09T12:00:00'), 0)),
        ...[-1, 1.5, '3', NaN, Infinity, undefined].map((duration) => attempt(() => addBusinessTime(cal, at('2024-03-04T09:00:00'), duration))),
      ];
    },
  },
  {
    name: 'business time between two instants follows the offset, the holidays and the special days, and an end before the start is a RangeError',
    run: async ({ load }) => {
      const { businessTimeBetween } = await lib(load);
      const cal = await day(load, { offsetMinutes: 330, holidays: ['2024-03-05'], special: { '2024-03-09': [['10:00', '12:00']] } });
      return [
        businessTimeBetween(cal, at('2024-03-04T00:00:00'), at('2024-03-11T00:00:00')) / HOUR,
        businessTimeBetween(cal, at('2024-03-04T00:00:00'), at('2024-03-04T00:00:00')),
        businessTimeBetween(cal, at('2024-03-04T05:00:00'), at('2024-03-04T06:00:00')) / HOUR,
        attempt(() => businessTimeBetween(cal, at('2024-03-05T00:00:00'), at('2024-03-04T00:00:00'))),
      ];
    },
  },
  {
    name: 'a special day replaces the weekly windows, and a special day with no windows closes the day',
    run: async ({ load }) => {
      const { addBusinessTime, nextOpen } = await lib(load);
      const short = await office(load, { special: { '2024-03-06': [['10:00', '11:00']] } });
      const closed = await office(load, { special: { '2024-03-06': [] } });
      return [
        iso(addBusinessTime(short, at('2024-03-06T09:00:00'), 2 * HOUR)),
        iso(nextOpen(closed, at('2024-03-06T08:00:00'))),
        iso(addBusinessTime(closed, at('2024-03-05T16:00:00'), 2 * HOUR)),
      ];
    },
  },
  {
    name: 'keeps the refusal of bad dates, bad windows and a date that is a holiday and a special day',
    run: async ({ load }) => [
      await valid(load, { holidays: ['2024-02-29'] }),
      await valid(load, { holidays: ['2023-02-29'] }),
      await valid(load, { holidays: ['2024-3-4'] }),
      await valid(load, { holidays: ['2024-13-01'] }),
      await valid(load, { holidays: ['2024-03-04'], special: { '2024-03-04': DAY } }),
      await valid(load, { special: { '2024-03-04': 'open' } }),
      await valid(load, { week: { 1: [['10:00', '10:00']] } }),
      await valid(load, { week: { 1: [['13:00', '09:00']] } }),
      await valid(load, { week: { 1: 'always' } }),
      await valid(load, { week: { 1: [['09:00']] } }),
      await valid(load, { week: { 1: [['09:00', '12:00'], ['11:00', '13:00']] } }),
      await valid(load, { week: { 1: [['09-00', '12:00']] } }),
    ],
  },
  {
    name: 'a time has minutes below 60 and hours up to 24, and 24:00 is the end of the day',
    run: async ({ load }) => [
      await valid(load, { week: { 1: [['09:75', '11:00']] } }),
      await valid(load, { week: { 1: [['09:60', '11:00']] } }),
      await valid(load, { week: { 1: [['09:00', '10:75']] } }),
      await valid(load, { week: { 1: [['09:00', '09:59']] } }),
      await valid(load, { week: { 1: [['09:00', '24:00']] } }),
      await valid(load, { week: { 1: [['09:00', '24:01']] } }),
      await valid(load, { week: { 1: [['25:00', '26:00']] } }),
      await valid(load, { week: { 1: [['09:00', '9:30']] } }),
    ],
  },
  {
    name: 'windows that touch are allowed, windows that overlap are not, and the order of the list does not matter',
    run: async ({ load }) => {
      const { addBusinessTime } = await lib(load);
      const touch = await make(load, { week: { 1: [['09:00', '12:00'], ['12:00', '13:00']] } });
      const unsorted = await make(load, { week: { 1: [['13:00', '17:00'], ['09:00', '12:00']] } });
      return [
        iso(addBusinessTime(touch, at('2024-03-04T11:00:00'), 2 * HOUR)),
        iso(addBusinessTime(unsorted, at('2024-03-04T11:00:00'), 2 * HOUR)),
        await valid(load, { week: { 1: [['09:00', '12:01'], ['12:00', '13:00']] } }),
        await valid(load, { week: { 1: [['09:00', '12:00'], ['12:00', '13:00']] } }),
      ];
    },
  },
  {
    name: 'the offset is a whole number of minutes from -720 to 840',
    run: async ({ load }) => [
      await valid(load, { offsetMinutes: 840 }),
      await valid(load, { offsetMinutes: -720 }),
      await valid(load, { offsetMinutes: 720 }),
      await valid(load, { offsetMinutes: 841 }),
      await valid(load, { offsetMinutes: -721 }),
      await valid(load, { offsetMinutes: 90.5 }),
      await valid(load, { offsetMinutes: '60' }),
      await valid(load, { offsetMinutes: NaN }),
    ],
  },
  {
    name: 'a week key other than 0 to 6 is refused',
    run: async ({ load }) => [
      await valid(load, { week: { 7: DAY } }),
      await valid(load, { week: { monday: DAY } }),
      await valid(load, { week: { '-1': DAY } }),
      await valid(load, { week: { 1.5: DAY } }),
      await valid(load, { week: { 0: DAY, 6: DAY } }),
      await valid(load, { week: { '1': DAY } }),
    ],
  },
  {
    name: 'keeps a calendar that is never open, one with far special days, and the ten year limit',
    run: async ({ load }) => {
      const { addBusinessTime, nextOpen, businessTimeBetween } = await lib(load);
      const none = await make(load, {});
      const soon = await make(load, { special: { '2024-03-09': [['10:00', '12:00']] } });
      const late = await make(load, { special: { '2036-03-09': [['10:00', '12:00']] } });
      return [
        attempt(() => addBusinessTime(none, at('2024-03-04T09:00:00'), 1)),
        attempt(() => nextOpen(none, at('2024-03-04T09:00:00'))),
        businessTimeBetween(none, at('2024-03-04T09:00:00'), at('2024-03-10T09:00:00')),
        iso(nextOpen(soon, at('2024-03-04T09:00:00'))),
        attempt(() => nextOpen(late, at('2024-03-04T09:00:00'))),
      ];
    },
  },
  {
    name: 'keeps elapsed time, remaining time and a deadline ahead for a running clock',
    run: async ({ load }) => {
      const cal = await day(load);
      return [
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [ev('start', '2024-03-04T09:00:00')], now: at('2024-03-04T11:00:00') }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [ev('start', '2024-03-08T15:00:00')], now: at('2024-03-11T10:00:00') }),
        await sla(load, {
          calendar: cal,
          target: 4 * HOUR,
          events: [ev('start', '2024-03-08T15:00:00'), ev('pause', '2024-03-08T16:00:00'), ev('resume', '2024-03-11T10:00:00')],
          now: at('2024-03-11T10:30:00'),
        }),
      ];
    },
  },
  {
    name: 'keeps the clock stopped by a pause and started by a resume, over days',
    run: async ({ load }) => {
      const cal = await day(load);
      const events = [
        ev('start', '2024-03-04T09:00:00'),
        ev('pause', '2024-03-04T10:00:00'),
        ev('resume', '2024-03-05T15:00:00'),
        ev('pause', '2024-03-05T16:00:00'),
        ev('resume', '2024-03-05T16:30:00'),
      ];
      return [await sla(load, { calendar: cal, target: 8 * HOUR, events, now: at('2024-03-06T10:00:00') })];
    },
  },
  {
    name: 'a stop while paused adds no time',
    run: async ({ load }) => {
      const cal = await day(load);
      return [
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [ev('start', '2024-03-04T09:00:00'), ev('pause', '2024-03-04T10:00:00'), ev('stop', '2024-03-05T12:00:00')], now: at('2024-03-06T09:00:00') }),
        await sla(load, {
          calendar: cal,
          target: 4 * HOUR,
          events: [ev('start', '2024-03-04T09:00:00'), ev('pause', '2024-03-04T10:00:00'), ev('resume', '2024-03-05T10:00:00'), ev('pause', '2024-03-05T11:00:00'), ev('stop', '2024-03-05T15:00:00')],
          now: at('2024-03-06T09:00:00'),
        }),
      ];
    },
  },
  {
    name: 'events at the same instant are allowed and keep their order',
    run: async ({ load }) => {
      const cal = await day(load);
      return [
        await sla(load, {
          calendar: cal,
          target: 4 * HOUR,
          events: [ev('start', '2024-03-04T09:00:00'), ev('pause', '2024-03-04T10:00:00'), ev('resume', '2024-03-04T10:00:00'), ev('pause', '2024-03-04T11:00:00'), ev('stop', '2024-03-04T11:00:00')],
          now: at('2024-03-04T12:00:00'),
        }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [ev('start', '2024-03-04T09:00:00'), ev('pause', '2024-03-04T09:00:00')], now: at('2024-03-04T12:00:00') }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [ev('start', '2024-03-04T09:00:00'), ev('stop', '2024-03-04T09:00:00')], now: at('2024-03-04T09:00:00') }),
      ];
    },
  },
  {
    name: 'keeps the refusal of a bad history, a bad target and a bad warning level',
    run: async ({ load }) => {
      const cal = await day(load);
      const base = { calendar: cal, target: HOUR, events: [ev('start', '2024-03-04T09:00:00')], now: at('2024-03-04T09:30:00') };
      const events = (list) => ({ ...base, events: list });
      return [
        await sla(load, events([])),
        await sla(load, events(undefined)),
        await sla(load, events([ev('pause', '2024-03-04T09:00:00')])),
        await sla(load, events([ev('start', '2024-03-04T09:00:00'), ev('start', '2024-03-04T09:30:00')])),
        await sla(load, events([ev('start', '2024-03-04T09:00:00'), ev('resume', '2024-03-04T09:30:00')])),
        await sla(load, events([ev('start', '2024-03-04T09:00:00'), ev('pause', '2024-03-04T09:30:00'), ev('pause', '2024-03-04T09:40:00')])),
        await sla(load, events([ev('start', '2024-03-04T09:00:00'), ev('stop', '2024-03-04T09:30:00'), ev('resume', '2024-03-04T09:40:00')])),
        await sla(load, events([ev('start', '2024-03-04T10:00:00'), ev('pause', '2024-03-04T09:00:00')])),
        await sla(load, events([{ type: 'start' }])),
        await sla(load, { ...base, now: at('2024-03-04T08:00:00') }),
        await sla(load, { ...base, target: 0 }),
        await sla(load, { ...base, target: 1.5 }),
        await sla(load, { ...base, target: '3600000' }),
        await sla(load, { ...base, warnPercent: 0 }),
        await sla(load, { ...base, warnPercent: 101 }),
        await sla(load, { ...base, warnPercent: NaN }),
        await sla(load, { ...base, warnPercent: null }),
        await sla(load, { ...base, warnPercent: undefined }),
      ];
    },
  },
  {
    name: 'a ticket is breached only when the elapsed time is more than the target',
    run: async ({ load }) => {
      const cal = await day(load);
      const stopAt = (text) => [ev('start', '2024-03-04T09:00:00'), ev('stop', text)];
      return [
        await sla(load, { calendar: cal, target: 4 * HOUR, events: stopAt('2024-03-04T13:00:00'), now: at('2024-03-04T14:00:00') }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: stopAt('2024-03-04T13:00:00.001'), now: at('2024-03-04T14:00:00') }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [ev('start', '2024-03-04T09:00:00')], now: at('2024-03-04T13:00:00') }),
      ];
    },
  },
  {
    name: 'a ticket is at risk from the warning level up to the target, and the level counts exactly',
    run: async ({ load }) => {
      const cal = await day(load);
      const ran = (from, to) => [ev('start', from), ev('stop', to)];
      return [
        await sla(load, { calendar: cal, target: 10 * HOUR, events: ran('2024-03-04T09:00:00', '2024-03-04T17:00:00'), now: at('2024-03-05T09:00:00') }),
        await sla(load, { calendar: cal, target: 10 * HOUR, events: ran('2024-03-04T09:00:00', '2024-03-04T16:59:59.999'), now: at('2024-03-05T09:00:00') }),
        await sla(load, { calendar: cal, target: 100, events: ran('2024-03-04T09:00:00', '2024-03-04T09:00:00.033'), now: at('2024-03-05T09:00:00'), warnPercent: 33 }),
        await sla(load, { calendar: cal, target: 100, events: ran('2024-03-04T09:00:00', '2024-03-04T09:00:00.032'), now: at('2024-03-05T09:00:00'), warnPercent: 33 }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: ran('2024-03-04T09:00:00', '2024-03-04T13:00:00'), now: at('2024-03-05T09:00:00'), warnPercent: 100 }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: ran('2024-03-04T09:00:00', '2024-03-04T13:00:00.001'), now: at('2024-03-05T09:00:00'), warnPercent: 100 }),
      ];
    },
  },
  {
    name: 'a clock that passed its target keeps the instant it passed it, running, paused or stopped, and a stopped or paused clock short of it has none',
    run: async ({ load }) => {
      const cal = await day(load);
      const start = ev('start', '2024-03-04T09:00:00');
      return [
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [start], now: at('2024-03-04T15:00:00') }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [start, ev('pause', '2024-03-04T14:00:00')], now: at('2024-03-06T10:00:00') }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [start, ev('stop', '2024-03-04T15:00:00')], now: at('2024-03-06T10:00:00') }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [start, ev('pause', '2024-03-04T10:00:00')], now: at('2024-03-06T10:00:00') }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [start, ev('stop', '2024-03-04T10:00:00')], now: at('2024-03-06T10:00:00') }),
        await sla(load, { calendar: cal, target: 4 * HOUR, events: [start], now: at('2024-03-04T13:00:00') }),
      ];
    },
  },
  {
    name: 'keeps a policy with a response clock and a resolution clock',
    run: async ({ load }) => {
      const { createSlaPolicy } = await lib(load);
      const cal = await office(load);
      const policy = createSlaPolicy({ calendars: { office: cal }, priorities: { P1: { calendar: 'office', response: HOUR, resolution: 4 * HOUR } } });
      const show = (result) => ({ response: { elapsed: minutes(result.response.elapsed), state: result.response.state, deadline: iso(result.response.deadline) }, resolution: { elapsed: minutes(result.resolution.elapsed), state: result.resolution.state, deadline: iso(result.resolution.deadline) } });
      return [
        show(policy.evaluate({ priority: 'P1', createdAt: at('2024-03-04T09:00:00'), firstResponseAt: at('2024-03-04T09:30:00'), events: [ev('start', '2024-03-04T09:00:00')] }, at('2024-03-04T12:00:00'))),
        show(policy.evaluate({ priority: 'P1', createdAt: at('2024-03-04T09:00:00'), events: [ev('start', '2024-03-04T09:00:00')] }, at('2024-03-04T09:45:00'))),
      ];
    },
  },
  {
    name: 'the response clock does not stop for a pause, the resolution clock does',
    run: async ({ load }) => {
      const { createSlaPolicy } = await lib(load);
      const cal = await day(load);
      const policy = createSlaPolicy({ calendars: { office: cal }, priorities: { P1: { calendar: 'office', response: HOUR, resolution: 4 * HOUR } } });
      const show = (result) => ({ response: [minutes(result.response.elapsed), result.response.state, result.response.breached], resolution: [minutes(result.resolution.elapsed), result.resolution.state] });
      return [
        show(policy.evaluate({ priority: 'P1', createdAt: at('2024-03-04T09:00:00'), events: [ev('start', '2024-03-04T09:00:00'), ev('pause', '2024-03-04T09:10:00'), ev('resume', '2024-03-04T12:00:00')] }, at('2024-03-04T13:00:00'))),
        show(policy.evaluate({ priority: 'P1', createdAt: at('2024-03-04T09:00:00'), firstResponseAt: at('2024-03-04T11:00:00'), events: [ev('start', '2024-03-04T09:00:00'), ev('pause', '2024-03-04T09:30:00')] }, at('2024-03-04T13:00:00'))),
        show(policy.evaluate({ priority: 'P1', createdAt: at('2024-03-04T09:00:00'), firstResponseAt: at('2024-03-04T09:20:00'), events: [ev('start', '2024-03-04T09:00:00'), ev('stop', '2024-03-04T09:10:00')] }, at('2024-03-04T13:00:00'))),
      ];
    },
  },
  {
    name: 'a calendar or priority named like an object property is not a name in the policy',
    run: async ({ load }) => {
      const { createSlaPolicy } = await lib(load);
      const cal = await day(load);
      const rule = (calendar) => ({ calendar, response: HOUR, resolution: 4 * HOUR });
      const ticket = (priority) => ({ priority, createdAt: at('2024-03-04T09:00:00'), events: [ev('start', '2024-03-04T09:00:00')] });
      const policy = createSlaPolicy({ calendars: { office: cal }, priorities: { P1: rule('office') } });
      return [
        ...['toString', 'constructor', 'hasOwnProperty', '__proto__'].map((name) => attempt(() => (createSlaPolicy({ calendars: { office: cal }, priorities: { P1: rule(name) } }), 'ok'))),
        ...['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf'].map((name) => attempt(() => policy.evaluate(ticket(name), at('2024-03-04T10:00:00')))),
      ];
    },
  },
  {
    name: 'keeps the refusal of an unknown priority and of a priority with an unknown calendar',
    run: async ({ load }) => {
      const { createSlaPolicy } = await lib(load);
      const cal = await day(load);
      const policy = createSlaPolicy({ calendars: { office: cal }, priorities: { P1: { calendar: 'office', response: HOUR, resolution: 4 * HOUR } } });
      return [
        attempt(() => policy.evaluate({ priority: 'P9', createdAt: at('2024-03-04T09:00:00'), events: [ev('start', '2024-03-04T09:00:00')] }, at('2024-03-04T10:00:00'))),
        attempt(() => policy.evaluate({ priority: undefined, createdAt: at('2024-03-04T09:00:00'), events: [ev('start', '2024-03-04T09:00:00')] }, at('2024-03-04T10:00:00'))),
        attempt(() => (createSlaPolicy({ calendars: { office: cal }, priorities: { P1: { calendar: 'night', response: HOUR, resolution: HOUR } } }), 'ok')),
        attempt(() => (createSlaPolicy({ calendars: { office: cal }, priorities: {} }), 'ok')),
      ];
    },
  },
  {
    name: 'a ticket over a weekend, a holiday and a special day, east of UTC, with pauses',
    run: async ({ load }) => {
      const { createSlaPolicy, createCalendar } = await lib(load);
      const india = createCalendar({
        offsetMinutes: 330,
        week: week([['09:00', '13:00'], ['14:00', '18:00']]),
        holidays: ['2024-03-05'],
        special: { '2024-03-09': [['10:00', '12:00']] },
      });
      const policy = createSlaPolicy({ calendars: { india }, priorities: { P2: { calendar: 'india', response: 2 * HOUR, resolution: 12 * HOUR } } });
      const events = [
        ev('start', '2024-03-04T05:00:00'),
        ev('pause', '2024-03-04T08:00:00'),
        ev('resume', '2024-03-07T04:00:00'),
        ev('pause', '2024-03-07T07:00:00'),
        ev('resume', '2024-03-07T07:00:00'),
        ev('stop', '2024-03-09T05:00:00'),
      ];
      const show = (item) => ({ state: item.state, elapsed: minutes(item.elapsed), remaining: minutes(item.remaining), breached: item.breached, atRisk: item.atRisk, deadline: iso(item.deadline) });
      const result = policy.evaluate({ priority: 'P2', createdAt: at('2024-03-04T05:00:00'), firstResponseAt: at('2024-03-06T04:00:00'), events }, at('2024-03-12T00:00:00'));
      const open = policy.evaluate({ priority: 'P2', createdAt: at('2024-03-08T11:00:00'), events: [ev('start', '2024-03-08T11:00:00')] }, at('2024-03-11T03:30:00'));
      return [show(result.response), show(result.resolution), show(open.response), show(open.resolution)];
    },
  },
];
