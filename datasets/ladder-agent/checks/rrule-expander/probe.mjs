// Hidden probes for rrule-expander; expected.json holds the answers.
// Every probe returns one line per input: its index, then the result as JSON, or the error class and message.
const lib = (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};
const show = (value) => JSON.stringify(value);
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
};
const prng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const START = '20240101T090000Z';
/** The text of a recurrence: a rule, a start (default 2024-01-01 09:00:00) and EXDATE lines. */
const T = (rule, start = START, ...exdates) => [`DTSTART:${start}`, `RRULE:${rule}`, ...exdates.map((item) => `EXDATE:${item}`)].join('\n');

const parseAll = (items) => async ({ load }) => {
  const { parse } = await lib(load);
  return items.map((text, index) => `${index}| ${show(attempt(() => parse(text)))}`);
};
const expandAll = (items) => async ({ load }) => {
  const { expand } = await lib(load);
  return items.map((item, index) => {
    const [text, options] = Array.isArray(item) ? item : [item];
    return `${index}| ${show(attempt(() => expand(text, options)))}`;
  });
};
/** Reports `ok` for a text that parses and the thrown error otherwise; for probes of the error rules. */
const verdicts = (items) => async ({ load }) => {
  const { parse } = await lib(load);
  return items.map((text, index) => `${index}| ${attempt(() => (parse(text), 'ok'))}`);
};
/** The value of one part of a rule after parse, or the error. */
const partOf = (rule, key) => async ({ load }) => {
  const { parse } = await lib(load);
  return rule.map((text, index) => `${index}| ${show(attempt(() => parse(T(text)).rule[key]))}`);
};

const pad = (n, width = 2) => String(n).padStart(width, '0');
const isoOf = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const DAY = 86400000;

/**
 * Runs `run(size, input)` for growing sizes and stops at the first one that takes longer than the guard (CPU ms).
 * `prepare(size)` builds the input before the clock starts, so that only the solution's own work is timed.
 */
const chunks = (sizes, guard, run, prepare = () => undefined) => {
  const rows = [];
  for (const size of sizes) {
    const input = prepare(size);
    const t = cpuMs();
    const row = run(size, input);
    const elapsed = cpuMs() - t;
    rows.push(`${size}| ${row}`);
    if (elapsed > guard) {
      rows.push('too slow');
      break;
    }
  }
  return rows;
};
const summary = (list) => `${list.length} ${list[0]} ${list[list.length - 1]}`;

// A random valid rule, built from a seed. Used by the random probes.
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
function randomRule(random) {
  const int = (low, high) => low + Math.floor(random() * (high - low + 1));
  const pick = (list) => list[int(0, list.length - 1)];
  const some = (list, n) => [...new Set(Array.from({ length: n }, () => pick(list)))];
  const freq = pick(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
  const parts = [`FREQ=${freq}`];
  if (random() < 0.5) parts.push(`INTERVAL=${int(1, 4)}`);
  let by = 0;
  if (random() < 0.3) {
    parts.push(`BYMONTH=${some([1, 2, 3, 4, 6, 9, 11, 12], int(1, 3)).join(',')}`);
    by += 1;
  }
  if (freq !== 'WEEKLY' && random() < 0.35) {
    parts.push(`BYMONTHDAY=${some([1, 2, 15, 28, 29, 30, 31, -1, -2, -5, -31], int(1, 3)).join(',')}`);
    by += 1;
  }
  if (random() < 0.4) {
    const ordinals = freq === 'MONTHLY' || freq === 'YEARLY';
    const days = some(WEEKDAYS, int(1, 3)).map((day) => (ordinals && random() < 0.5 ? `${pick([1, 2, 3, 4, 5, -1, -2])}${day}` : day));
    parts.push(`BYDAY=${days.join(',')}`);
    by += 1;
  }
  if (by > 0 && random() < 0.3) parts.push(`BYSETPOS=${some([1, 2, 3, -1, -2, 5, 31], int(1, 2)).join(',')}`);
  if (random() < 0.3) parts.push(`WKST=${pick(WEEKDAYS)}`);
  const year = int(1970, 2030);
  const month = int(1, 12);
  const day = Math.min(int(1, 31), new Date(Date.UTC(year, month, 0)).getUTCDate());
  const start = `${year}${pad(month)}${pad(day)}T${pad(int(0, 23))}${pad(int(0, 59))}${pad(int(0, 59))}Z`;
  const kind = random();
  if (kind < 0.6) parts.push(`COUNT=${int(1, 25)}`);
  else if (kind < 0.8) parts.push(`UNTIL=${year + int(0, 12)}${pad(int(1, 12))}${pad(int(1, 28))}${random() < 0.5 ? `T${pad(int(0, 23))}0000Z` : ''}`);
  const exdates = [];
  for (let n = int(0, 3); n > 0; n -= 1) exdates.push(`${year + int(0, 2)}${pad(int(1, 12))}${pad(int(1, 28))}${random() < 0.5 ? 'T000000Z' : ''}`);
  return { text: T(parts.join(';'), start, ...(exdates.length ? [exdates.join(',')] : [])), year, int };
}

export const probes = [
  {
    name: 'rr01',
    run: parseAll([
      'DTSTART:20240115T093000Z\nRRULE:FREQ=DAILY',
      'DTSTART:20240115T093000Z\nRRULE:WKST=SU;BYSETPOS=-1,1,1;BYDAY=FR,-1MO,+2TU,2TU,MO;BYMONTHDAY=-1,15,1,-1;BYMONTH=12,1,12;COUNT=10;INTERVAL=3;FREQ=MONTHLY',
      'DTSTART:20240115T093000Z\nRRULE:FREQ=YEARLY;UNTIL=20301231',
      'DTSTART:20240115T093000Z\r\nRRULE:FREQ=WEEKLY;UNTIL=20301231T120000Z\r\n\r\n',
      'RRULE:FREQ=DAILY\n\nEXDATE:20240303,20240102T090000Z\nDTSTART:20240101T090000Z\nEXDATE:20240102T090000Z,20240101',
      'DTSTART:19700101T000000Z\nRRULE:BYDAY=SU,-2SA,3SA,MO,-1MO,1MO,-53SU,+53SU;FREQ=YEARLY',
      'DTSTART:29991231T235959Z\nRRULE:FREQ=DAILY;INTERVAL=9999;COUNT=999999999',
      'DTSTART:20240115T093000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=+5,-31,31;BYSETPOS=366,-366,+7;BYMONTH=1',
    ]),
  },
  {
    name: 'rr02',
    run: verdicts([
      '',
      'DTSTART:20240101T090000Z',
      'RRULE:FREQ=DAILY',
      'DTSTART:20240101T090000Z\nRRULE FREQ=DAILY',
      'DTSTART:20240101T090000Z\n\n\nrrule:FREQ=DAILY',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY\nSUMMARY:x',
      'DTSTART:20240101T090000Z\nDTSTART:20240102T090000Z\nRRULE:FREQ=DAILY',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY\nRRULE:FREQ=DAILY',
      'RRULE:FREQ=DAILY\nRRULE:FREQ=HOURLY',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY\n DTSTART:20240101T090000Z',
      'DTSTART:20240101T090000Z \nRRULE:FREQ=DAILY',
      'DTSTART:20240101T090000Z\nRRULE:\n',
      'DTSTART:\nRRULE:FREQ=DAILY',
      'dtstart:20240101T090000Z\nRRULE:FREQ=DAILY',
      'DTSTART:20240101T090000Z\r\nRRULE:FREQ=DAILY\r\nEXDATE:20240102\r\nFOO:1',
      'DTSTART20240101T090000Z',
      'X-Y:1',
      'DTSTART:20240101T090000Z\rRRULE:FREQ=DAILY',
      'DTSTART:20240101T090000Z\n\r\nRRULE:FREQ=DAILY\n\n\nBYDAY:MO',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY\n:x',
    ]),
  },
  {
    name: 'rr03',
    run: verdicts([
      T('FREQ=HOURLY'),
      T('FREQ=daily'),
      T('FREQ='),
      T('FREQ=DAILY;INTERVAL=0'),
      T('FREQ=DAILY;BYHOUR=3'),
      T('FREQ=DAILY;byday=MO'),
      T('FREQ=DAILY;COUNT=2;COUNT=3'),
      T('FREQ=DAILY;FREQ=DAILY'),
      T('FREQ=DAILY;'),
      T(';FREQ=DAILY'),
      T('FREQ=DAILY;;COUNT=1'),
      T('FREQ=DAILY;COUNT'),
      T('FREQ=DAILY;=3'),
      T('FREQ=DAILY;COUNT=3='),
      T('FREQ=DAILY;WKST=XX'),
      T('FREQ=DAILY;WKST=mo'),
      T('FREQ=DAILY;WKST=MO,TU'),
      T('FREQ=DAILY;UNTIL=2025'),
      T('FREQ=DAILY;UNTIL=20250101T000000'),
      T('FREQ=DAILY;UNTIL=20250101T000000Z'),
      T('FREQ=DAILY;UNTIL=20250101'),
      T('FREQ=DAILY;COUNT=2; INTERVAL=1'),
      T('FREQ=DAILY;INTERVAL=1;BYWEEKNO=3'),
      T('FREQ=DAILY;BYYEARDAY=3'),
    ]),
  },
  {
    name: 'rr04',
    run: verdicts([
      T('FREQ=DAILY;COUNT=2;UNTIL=20250101'),
      T('COUNT=2;UNTIL=20250101'),
      T('BYDAY=MO'),
      T('FREQ=WEEKLY;BYMONTHDAY=3;BYDAY=2MO'),
      T('FREQ=WEEKLY;BYMONTHDAY=3'),
      T('FREQ=DAILY;BYDAY=1MO;BYSETPOS=1'),
      T('FREQ=DAILY;BYDAY=MO,1TU'),
      T('FREQ=WEEKLY;BYDAY=-1FR'),
      T('FREQ=MONTHLY;BYDAY=6MO'),
      T('FREQ=MONTHLY;BYDAY=-6TU'),
      T('FREQ=MONTHLY;BYDAY=5TU'),
      T('FREQ=MONTHLY;BYDAY=-5TU;BYSETPOS=1'),
      T('FREQ=YEARLY;BYDAY=20MO'),
      T('FREQ=YEARLY;BYDAY=54MO'),
      T('FREQ=YEARLY;BYDAY=53MO'),
      T('FREQ=YEARLY;BYMONTH=1;BYDAY=6MO'),
      T('FREQ=YEARLY;BYMONTH=1;BYDAY=5MO'),
      T('FREQ=DAILY;BYSETPOS=1'),
      T('FREQ=MONTHLY;INTERVAL=2;BYSETPOS=-1'),
      T('FREQ=DAILY;BYSETPOS=1;BYMONTH=1'),
      T('FREQ=DAILY;BYSETPOS=1;BYDAY=MO'),
      T('FREQ=WEEKLY;BYSETPOS=1;WKST=SU'),
      T('FREQ=DAILY;UNTIL=20240101T085959Z'),
      T('FREQ=DAILY;UNTIL=20240101T090000Z'),
      T('FREQ=DAILY;UNTIL=20231231'),
      T('FREQ=DAILY;UNTIL=20240101'),
      T('FREQ=DAILY;UNTIL=20240101T235959Z'),
      T('FREQ=MONTHLY;UNTIL=20200101;COUNT=1'),
      T('FREQ=MONTHLY;UNTIL=20200101;BYSETPOS=1'),
      T('FREQ=MONTHLY;UNTIL=20200101;BYDAY=6TU'),
    ]),
  },
  {
    name: 'rr05',
    run: partOf(
      ['INTERVAL=-1', 'INTERVAL=+1', 'INTERVAL=01', 'INTERVAL=10000', 'INTERVAL=9999', 'INTERVAL=1.5', 'INTERVAL= 1', 'INTERVAL=', 'INTERVAL=1e2', 'INTERVAL=1,2', 'INTERVAL=0x10', 'INTERVAL=7', 'INTERVAL=12'].map((part) => `FREQ=DAILY;${part}`),
      'interval',
    ),
  },
  {
    name: 'rr06',
    run: partOf(
      ['COUNT=0', 'COUNT=1', 'COUNT=999999999', 'COUNT=1000000000', 'COUNT=0000001', 'COUNT=-3', 'COUNT=+3', 'COUNT=3.0', 'COUNT=1_0', 'COUNT=٣', 'COUNT=00', 'COUNT=10'].map((part) => `FREQ=DAILY;${part}`),
      'count',
    ),
  },
  {
    name: 'rr07',
    run: partOf(
      ['BYMONTH=0', 'BYMONTH=13', 'BYMONTH=+1', 'BYMONTH=-1', 'BYMONTH=1,,2', 'BYMONTH=1,2,', 'BYMONTH=,1', 'BYMONTH=01', 'BYMONTH=12,1,12,6', 'BYMONTH=1, 2', 'BYMONTH=1;BYMONTH=2', 'BYMONTH=3,2,1', 'BYMONTH=10,9,100'].map((part) => `FREQ=DAILY;${part}`),
      'bymonth',
    ),
  },
  {
    name: 'rr08',
    run: partOf(
      ['BYMONTHDAY=0', 'BYMONTHDAY=32', 'BYMONTHDAY=-32', 'BYMONTHDAY=+5', 'BYMONTHDAY=-0', 'BYMONTHDAY=00', 'BYMONTHDAY=--1', 'BYMONTHDAY=-1,1,-31,31,-1,+1', 'BYMONTHDAY=2,-2,15,-15', 'BYMONTHDAY=1-', 'BYMONTHDAY=−1', 'BYMONTHDAY=-01', 'BYMONTHDAY=31,30,29'].map((part) => `FREQ=MONTHLY;${part}`),
      'bymonthday',
    ),
  },
  {
    name: 'rr09',
    run: partOf(
      ['BYSETPOS=0', 'BYSETPOS=367', 'BYSETPOS=-367', 'BYSETPOS=366', 'BYSETPOS=-366', 'BYSETPOS=+1', 'BYSETPOS=1,-1,2,-2,1', 'BYSETPOS=1,0', 'BYSETPOS=3,2,1,-1,-2,-3', 'BYSETPOS=01', 'BYSETPOS=1.0'].map((part) => `FREQ=MONTHLY;BYMONTH=1;${part}`),
      'bysetpos',
    ),
  },
  {
    name: 'rr10',
    run: partOf(
      ['BYDAY=MO', 'BYDAY=mo', 'BYDAY=MON', 'BYDAY=+MO', 'BYDAY=-MO', 'BYDAY=0MO', 'BYDAY=1MO', 'BYDAY=+1MO', 'BYDAY=-1MO', 'BYDAY=01MO', 'BYDAY=-53SU', 'BYDAY=53SU', 'BYDAY=54SU', 'BYDAY=100SU', 'BYDAY=2 TU', 'BYDAY=MO,', 'BYDAY=,MO', 'BYDAY=MO,,TU', 'BYDAY=1MO2', 'BYDAY=-1', 'BYDAY=M0', 'BYDAY=SU,SA,FR,TH,WE,TU,MO', 'BYDAY=-2SA,3SA,-1SA,MO,1SA,3SA,+3SA,MO', 'BYDAY=-0MO', 'BYDAY=+-1MO', 'BYDAY=1-MO', 'BYDAY=1.MO', 'BYDAY=MO1'].map((part) => `FREQ=YEARLY;${part}`),
      'byday',
    ),
  },
  {
    name: 'rr11',
    run: parseAll(
      [
        '19700101T000000Z', '19691231T235959Z', '29991231T235959Z', '30000101T000000Z', '20240230T000000Z', '20230229T000000Z', '20000229T000000Z', '21000229T000000Z', '20240101T240000Z', '20240101T236000Z',
        '20240101T230060Z', '20240101T000000', '20240101', '2024-01-01T00:00:00Z', '20241301T000000Z', '20240001T000000Z', '20240100T000000Z', '20240431T000000Z', '20240101t000000z', '20240101T000000z',
        '20240101T0000000Z', '24010100000Z', '20240101 T000000Z', '20241231T235959Z', '20240229T000000Z', '+20240101T000000Z', '20240101T000000Z\n',
      ].map((value) => `DTSTART:${value}\nRRULE:FREQ=DAILY;COUNT=1`),
    ),
  },
  {
    name: 'rr12',
    run: verdicts(
      [
        ['EXDATE:20240101T090000Z,,20240102'],
        ['EXDATE:'],
        ['EXDATE:20240230'],
        ['EXDATE:20240229'],
        ['EXDATE:20240101T090000Z,20240102T09'],
        ['EXDATE:20240101T090000Z, 20240102'],
        ['EXDATE:20240101T090000Z', 'EXDATE:20240101T090000'],
        ['EXDATE:19691231', 'EXDATE:bad'],
        ['EXDATE:30000101'],
        ['EXDATE:29991231T235959Z,19700101'],
        ['EXDATE:2024-01-01'],
        ['EXDATE:20240101T240000Z'],
        ['EXDATE:20240101T090000Z,'],
      ].map((lines) => `DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;COUNT=2\n${lines.join('\n')}`),
    ),
  },
  {
    name: 'rr13',
    run: verdicts([
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;UNTIL=20240230',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;UNTIL=30000101',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;UNTIL=29991231T235959Z',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;UNTIL=19691231',
      'RRULE:COUNT=2\nFOO:1',
      'RRULE:COUNT=2',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;COUNT=2;UNTIL=x',
      'DTSTART:xx\nRRULE:FREQ=HOURLY',
      'EXDATE:x',
      'EXDATE:20240101\nFOO:1',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=HOURLY\nEXDATE:x',
      'DTSTART:20240101T090000Z\nEXDATE:x\nRRULE:FREQ=HOURLY',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=HOURLY;FOO=1',
      'DTSTART:20240101T090000Z\nRRULE:FOO=1;FREQ=HOURLY',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;INTERVAL=0;INTERVAL=0',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;COUNT=1;COUNT=x',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;BYMONTH=13;BYMONTH=13',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;BYHOUR=1;BYHOUR=1',
      'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;=\nDTSTART:2',
    ]),
  },
  {
    name: 'rr14',
    run: async ({ load }) => {
      const { parse, expand } = await lib(load);
      const text = T('FREQ=DAILY;COUNT=2');
      const odd = [undefined, null, 123, {}, [], ['DTSTART:20240101T090000Z'], true, () => text];
      const lines = odd.map((value, index) => `${index}| ${attempt(() => parse(value))} / ${attempt(() => expand(value))}`);
      const options = [null, 5, 'x', true, { limit: 0 }, { limit: 100001 }, { limit: 100000 }, { limit: 1.5 }, { limit: '5' }, { limit: null }, { limit: NaN }, { limit: -1 }, { limit: undefined }, { limit: 1 }, { limit: Infinity }];
      options.forEach((option, index) => lines.push(`o${index}| ${show(attempt(() => expand(text, option)))}`));
      const more = [{ from: '20240101' }, { from: 5 }, { from: null }, { to: 'x' }, { to: '20240102T090000Z' }, { from: 'x', to: 'y' }, { limit: 0, from: 'x' }, { limit: 5, from: '20240102T090000Z', to: 'bad' }, { from: '19691231T000000Z' }, { to: '30000101T000000Z' }, { from: undefined, to: undefined }, { other: 1 }];
      more.forEach((option, index) => lines.push(`m${index}| ${show(attempt(() => expand(text, option)))}`));
      lines.push(`p| ${show(attempt(() => expand('DTSTART:x\nRRULE:FREQ=DAILY', { limit: 0 })))}`);
      return lines;
    },
  },
  {
    name: 'rr15',
    run: expandAll([
      T('FREQ=DAILY;COUNT=5'),
      T('FREQ=DAILY;INTERVAL=3;COUNT=6', '20240226T101112Z'),
      T('FREQ=DAILY;INTERVAL=2;COUNT=6', '20231228T000000Z'),
      T('FREQ=DAILY;BYMONTH=2;COUNT=30', '20240125T090000Z'),
      T('FREQ=DAILY;BYMONTH=2;COUNT=3', '20230225T090000Z'),
      T('FREQ=DAILY;BYMONTHDAY=1,15;COUNT=6'),
      T('FREQ=DAILY;BYMONTHDAY=-1;COUNT=14', '20240101T090000Z'),
      T('FREQ=DAILY;BYMONTHDAY=-1,-2;COUNT=6', '20240226T090000Z'),
      T('FREQ=DAILY;BYDAY=MO,WE,FR;COUNT=8'),
      T('FREQ=DAILY;BYDAY=SA;BYMONTHDAY=13,14,15,16,17,18,19;COUNT=4'),
      T('FREQ=DAILY;INTERVAL=7;BYDAY=MO;COUNT=3'),
      T('FREQ=DAILY;INTERVAL=7;BYDAY=TU;COUNT=3'),
      T('FREQ=DAILY;INTERVAL=2;BYDAY=TU;COUNT=3'),
      T('FREQ=DAILY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR,SA,SU;COUNT=5'),
      T('FREQ=DAILY;BYMONTH=12,1;BYMONTHDAY=31,1;COUNT=6', '20231215T090000Z'),
      T('FREQ=DAILY;UNTIL=20240105;BYDAY=TU,TH'),
      T('FREQ=DAILY;COUNT=3', '20241230T090000Z'),
      T('FREQ=DAILY;COUNT=3', '21000227T090000Z'),
      T('FREQ=DAILY;COUNT=3', '24000228T090000Z'),
    ]),
  },
  {
    name: 'rr16',
    run: expandAll([
      T('FREQ=WEEKLY;COUNT=4', '20240103T090000Z'),
      T('FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=7'),
      T('FREQ=WEEKLY;BYDAY=FR,MO,FR;COUNT=4', '20240103T090000Z'),
      T('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=6'),
      T('FREQ=WEEKLY;INTERVAL=3;COUNT=4', '20240229T090000Z'),
      T('FREQ=WEEKLY;INTERVAL=3;BYDAY=SU;COUNT=4', '20240131T090000Z'),
      T('FREQ=WEEKLY;BYMONTH=2;COUNT=5', '20240131T090000Z'),
      T('FREQ=WEEKLY;BYMONTH=1,3;BYDAY=SA,SU;COUNT=6', '20240115T090000Z'),
      T('FREQ=WEEKLY;BYDAY=MO,TU;COUNT=3', '20240110T090000Z'),
      T('FREQ=WEEKLY;BYDAY=SU;COUNT=3', '20240107T090000Z'),
      T('FREQ=WEEKLY;BYDAY=SU;COUNT=3', '20240106T090000Z'),
      T('FREQ=WEEKLY;INTERVAL=52;COUNT=4', '20240229T090000Z'),
      T('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,-1;COUNT=6'),
      T('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYSETPOS=2;COUNT=3', '20240103T090000Z'),
      T('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYSETPOS=1;COUNT=3', '20240103T090000Z'),
      T('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYSETPOS=-1,-1,1;WKST=SU;COUNT=5', '20240103T090000Z'),
    ]),
  },
  {
    name: 'rr17',
    run: expandAll(
      WEEKDAYS.map((wkst) => T(`FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,TU,WE,SA;WKST=${wkst};COUNT=9`, '20240110T090000Z')).concat(
        WEEKDAYS.map((wkst) => T(`FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=${wkst};COUNT=5`, '20240107T120000Z')),
        WEEKDAYS.map((wkst) => T(`FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,SU;WKST=${wkst};COUNT=5`, '20240107T120000Z')),
        WEEKDAYS.map((wkst) => T(`FREQ=WEEKLY;INTERVAL=3;WKST=${wkst};BYDAY=FR,SA,SU,MO;BYSETPOS=2,-1;COUNT=6`, '20240105T000000Z')),
      ),
    ),
  },
  {
    name: 'rr18',
    run: expandAll([
      T('FREQ=MONTHLY;COUNT=8', '20240131T090000Z'),
      T('FREQ=MONTHLY;COUNT=8', '20240130T090000Z'),
      T('FREQ=MONTHLY;COUNT=8', '20240129T090000Z'),
      T('FREQ=MONTHLY;COUNT=8', '20230129T090000Z'),
      T('FREQ=MONTHLY;COUNT=6', '20240128T090000Z'),
      T('FREQ=MONTHLY;INTERVAL=2;COUNT=8', '20240131T090000Z'),
      T('FREQ=MONTHLY;INTERVAL=5;COUNT=8', '20241130T090000Z'),
      T('FREQ=MONTHLY;INTERVAL=12;COUNT=4', '20240229T090000Z'),
      T('FREQ=MONTHLY;INTERVAL=13;COUNT=6', '20240131T090000Z'),
      T('FREQ=MONTHLY;INTERVAL=1;UNTIL=20240701', '20240131T090000Z'),
      T('FREQ=MONTHLY;BYMONTH=6,7,12;COUNT=5', '20240115T090000Z'),
      T('FREQ=MONTHLY;BYMONTH=2,4;COUNT=4', '20240131T090000Z'),
      T('FREQ=MONTHLY;COUNT=12', '20231201T090000Z'),
      T('FREQ=MONTHLY;INTERVAL=9999;COUNT=3', '20240101T090000Z'),
    ]),
  },
  {
    name: 'rr19',
    run: expandAll([
      T('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=14'),
      T('FREQ=MONTHLY;BYMONTHDAY=-1,1;COUNT=6'),
      T('FREQ=MONTHLY;BYMONTHDAY=29,30,31;COUNT=9'),
      T('FREQ=MONTHLY;BYMONTHDAY=-31;COUNT=4'),
      T('FREQ=MONTHLY;BYMONTHDAY=31,-31;COUNT=6'),
      T('FREQ=MONTHLY;BYMONTHDAY=-29;COUNT=4', '20240101T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=-29;COUNT=3', '20230101T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=-30,-31;COUNT=6', '20240101T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=15,1,-1,16;COUNT=9', '20240115T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=1;COUNT=3', '20240101T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=1;COUNT=3', '20240102T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=28,29;COUNT=5', '20240301T090000Z'),
      T('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=-1;COUNT=5', '20240131T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=-1;BYMONTH=2;COUNT=5', '20230101T090000Z'),
    ]),
  },
  {
    name: 'rr20',
    run: expandAll([
      T('FREQ=MONTHLY;BYDAY=2TU;COUNT=6'),
      T('FREQ=MONTHLY;BYDAY=-1FR;COUNT=6'),
      T('FREQ=MONTHLY;BYDAY=5MO;COUNT=6'),
      T('FREQ=MONTHLY;BYDAY=-5SU;COUNT=6'),
      T('FREQ=MONTHLY;BYDAY=1MO,-1MO;COUNT=6'),
      T('FREQ=MONTHLY;BYDAY=MO;COUNT=7'),
      T('FREQ=MONTHLY;BYDAY=2TU,2WE,4TH;COUNT=7'),
      T('FREQ=MONTHLY;BYDAY=+1SA,-1SA,3SA;COUNT=6'),
      T('FREQ=MONTHLY;BYDAY=5FR;COUNT=4', '20240101T090000Z'),
      T('FREQ=MONTHLY;BYDAY=5SA;COUNT=4', '20240101T090000Z'),
      T('FREQ=MONTHLY;BYDAY=-1SU;COUNT=6', '20240101T000000Z'),
      T('FREQ=MONTHLY;BYDAY=1TH;COUNT=4', '19700101T000000Z'),
      T('FREQ=MONTHLY;BYDAY=4TH;INTERVAL=2;COUNT=4', '20241107T000000Z'),
      T('FREQ=MONTHLY;BYDAY=3MO;COUNT=4', '21000101T000000Z'),
      T('FREQ=MONTHLY;BYDAY=-1WE;COUNT=3', '20240131T235959Z'),
      T('FREQ=MONTHLY;BYDAY=2TU;COUNT=3', '20240109T090000Z'),
      T('FREQ=MONTHLY;BYDAY=2TU;COUNT=3', '20240110T090000Z'),
    ]),
  },
  {
    name: 'rr21',
    run: expandAll([
      T('FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13;COUNT=5'),
      T('FREQ=MONTHLY;BYDAY=TU;BYMONTHDAY=8,9,10,11,12,13,14;COUNT=5'),
      T('FREQ=MONTHLY;BYDAY=-1SU;BYMONTHDAY=25,26,27,28,29,30,31;COUNT=5'),
      T('FREQ=MONTHLY;BYDAY=2TU;BYMONTHDAY=-1;COUNT=2'),
      T('FREQ=MONTHLY;BYDAY=MO,TU;BYMONTHDAY=1;COUNT=6'),
      T('FREQ=MONTHLY;BYDAY=1MO;BYMONTHDAY=-1,-2,-3,-4,-5,-6,-7;COUNT=2'),
      T('FREQ=MONTHLY;BYDAY=SA,SU;BYMONTHDAY=29,30,31;BYMONTH=2,3,4;COUNT=5'),
      T('FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13;BYMONTH=2,3;COUNT=3'),
      T('FREQ=MONTHLY;BYDAY=-1FR;BYMONTHDAY=29;COUNT=3'),
      T('FREQ=MONTHLY;BYDAY=TH;BYMONTHDAY=29,30,31;COUNT=5', '20231001T090000Z'),
    ]),
  },
  {
    name: 'rr22',
    run: expandAll([
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=7'),
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1;COUNT=7'),
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2;COUNT=4'),
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,-1;COUNT=6'),
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=22,23;COUNT=6'),
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=23,-23;COUNT=6'),
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,1,-1,-1;COUNT=5'),
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=3,2;COUNT=5'),
      T('FREQ=MONTHLY;BYMONTHDAY=1,15,-1;BYSETPOS=2;COUNT=5'),
      T('FREQ=MONTHLY;BYMONTHDAY=1,15,-1;BYSETPOS=-1,3;COUNT=5'),
      T('FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=-1;COUNT=5'),
      T('FREQ=MONTHLY;BYDAY=SA,SU;BYSETPOS=1;INTERVAL=2;COUNT=5'),
      T('FREQ=MONTHLY;BYDAY=2TU,4TU;BYSETPOS=2;COUNT=4'),
      T('FREQ=MONTHLY;BYDAY=2TU,4TU;BYSETPOS=3;COUNT=4'),
      T('FREQ=MONTHLY;BYMONTH=2,3;BYMONTHDAY=31,-1;BYSETPOS=1;COUNT=4'),
      T('FREQ=MONTHLY;BYMONTHDAY=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31;BYSETPOS=31,-31,30;COUNT=8', '20240101T090000Z'),
    ]),
  },
  {
    name: 'rr23',
    run: expandAll([
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1;COUNT=4', '20240110T090000Z'),
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,2;COUNT=5', '20240103T090000Z'),
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3', '20240131T090000Z'),
      T('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3', '20240131T090001Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=10,20;COUNT=4', '20240115T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=10,20;COUNT=4', '20240120T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=10,20;COUNT=4', '20240121T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=10,20;BYSETPOS=1;COUNT=3', '20240115T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=10,20;BYSETPOS=-1;COUNT=3', '20240115T090000Z'),
      T('FREQ=YEARLY;BYMONTH=1,6;BYMONTHDAY=1;BYSETPOS=1;COUNT=3', '20240115T090000Z'),
      T('FREQ=YEARLY;BYMONTH=1,6;BYMONTHDAY=1;BYSETPOS=1;COUNT=3', '20240101T090000Z'),
      T('FREQ=WEEKLY;BYDAY=MO,TU,WE;BYSETPOS=1;COUNT=3', '20240102T090000Z'),
      T('FREQ=DAILY;BYMONTHDAY=1;COUNT=2', '20240102T090000Z'),
      T('FREQ=MONTHLY;COUNT=3', '20240115T090000Z'),
      T('FREQ=MONTHLY;BYDAY=2TU;COUNT=3', '20240112T090000Z'),
      T('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1;COUNT=3', '20240108T090000Z'),
      T('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1;COUNT=3', '20240101T090000Z'),
      T('FREQ=YEARLY;BYDAY=TU;BYSETPOS=1;COUNT=3', '20240102T090000Z'),
      T('FREQ=YEARLY;BYDAY=TU;BYSETPOS=1;COUNT=3', '20240103T090000Z'),
    ]),
  },
  {
    name: 'rr24',
    run: expandAll([
      T('FREQ=YEARLY;COUNT=5', '20240229T100000Z'),
      T('FREQ=YEARLY;COUNT=5', '20960229T100000Z'),
      T('FREQ=YEARLY;COUNT=5', '20240301T100000Z'),
      T('FREQ=YEARLY;INTERVAL=4;COUNT=5', '20960229T100000Z'),
      T('FREQ=YEARLY;INTERVAL=100;COUNT=9', '20000229T100000Z'),
      T('FREQ=YEARLY;INTERVAL=100;COUNT=4', '19700101T100000Z'),
      T('FREQ=YEARLY;INTERVAL=3;COUNT=5', '20241231T235959Z'),
      T('FREQ=YEARLY;INTERVAL=400;COUNT=5', '20000229T000000Z'),
      T('FREQ=YEARLY;INTERVAL=1;UNTIL=20400229', '20240229T100000Z'),
      T('FREQ=YEARLY;BYMONTH=2,8;COUNT=6', '20240229T100000Z'),
      T('FREQ=YEARLY;BYMONTH=1,3,5,7,9,11;COUNT=8', '20240131T100000Z'),
      T('FREQ=YEARLY;BYMONTH=4,6;COUNT=5', '20240131T100000Z'),
      T('FREQ=YEARLY;BYMONTH=12,1,6;COUNT=7', '20240615T100000Z'),
      T('FREQ=YEARLY;BYMONTH=2;COUNT=4', '20240301T100000Z'),
      T('FREQ=YEARLY;BYMONTH=3;COUNT=3', '20240301T100000Z'),
      T('FREQ=YEARLY;COUNT=3', '29980101T000000Z'),
      T('FREQ=YEARLY;COUNT=3', '19700101T000000Z'),
    ]),
  },
  {
    name: 'rr25',
    run: expandAll([
      T('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;COUNT=5', '20241101T090000Z'),
      T('FREQ=YEARLY;BYMONTH=5;BYDAY=-1MO;COUNT=5'),
      T('FREQ=YEARLY;BYMONTH=3,10;BYDAY=-1SU;COUNT=6'),
      T('FREQ=YEARLY;BYMONTH=2;BYDAY=SU;COUNT=6'),
      T('FREQ=YEARLY;BYMONTH=2;BYDAY=5SU;COUNT=3'),
      T('FREQ=YEARLY;BYMONTH=2;BYDAY=5SU;COUNT=3', '20240101T090000Z'),
      T('FREQ=YEARLY;BYMONTH=1,7;BYDAY=1MO,-1MO;COUNT=8'),
      T('FREQ=YEARLY;BYMONTH=9;BYDAY=1MO;INTERVAL=2;COUNT=4'),
      T('FREQ=YEARLY;BYMONTH=6;BYDAY=FR;BYMONTHDAY=13;COUNT=3'),
      T('FREQ=YEARLY;BYMONTH=6;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=4'),
    ]),
  },
  {
    name: 'rr26',
    run: expandAll([
      T('FREQ=YEARLY;BYDAY=20MO;COUNT=5'),
      T('FREQ=YEARLY;BYDAY=-1FR;COUNT=5'),
      T('FREQ=YEARLY;BYDAY=1MO,-1MO;COUNT=6'),
      T('FREQ=YEARLY;BYDAY=53MO;COUNT=4'),
      T('FREQ=YEARLY;BYDAY=53TH;COUNT=4'),
      T('FREQ=YEARLY;BYDAY=-53MO;COUNT=3', '20240101T090000Z'),
      T('FREQ=YEARLY;BYDAY=-1TU;COUNT=3', '20241231T090000Z'),
      T('FREQ=YEARLY;BYDAY=SU;COUNT=6'),
      T('FREQ=YEARLY;BYDAY=FR,SA;COUNT=3', '20240630T090000Z'),
      T('FREQ=YEARLY;BYDAY=1SU;COUNT=3', '20240601T090000Z'),
      T('FREQ=YEARLY;BYDAY=2WE;COUNT=3', '20240601T090000Z'),
      T('FREQ=YEARLY;BYDAY=MO;INTERVAL=2;COUNT=3', '20240615T090000Z'),
      T('FREQ=YEARLY;BYDAY=20MO,-20MO;COUNT=4', '20250101T090000Z'),
      T('FREQ=YEARLY;BYDAY=-1MO;COUNT=3', '20241230T090000Z'),
      T('FREQ=YEARLY;BYDAY=-1MO;COUNT=3', '20241231T090000Z'),
    ]),
  },
  {
    name: 'rr27',
    run: expandAll([
      T('FREQ=YEARLY;BYMONTHDAY=1;COUNT=14'),
      T('FREQ=YEARLY;BYMONTHDAY=-1;COUNT=14'),
      T('FREQ=YEARLY;BYMONTHDAY=31;COUNT=9'),
      T('FREQ=YEARLY;BYMONTHDAY=29,30;COUNT=7'),
      T('FREQ=YEARLY;BYMONTHDAY=15;BYMONTH=1,7;COUNT=5'),
      T('FREQ=YEARLY;BYMONTHDAY=-1;BYMONTH=2;COUNT=4'),
      T('FREQ=YEARLY;BYMONTHDAY=29;BYMONTH=2;COUNT=3', '20240101T090000Z'),
      T('FREQ=YEARLY;BYMONTHDAY=1;INTERVAL=2;COUNT=14', '20240201T090000Z'),
      T('FREQ=YEARLY;BYMONTHDAY=1,-1;BYMONTH=12;COUNT=5'),
      T('FREQ=YEARLY;BYMONTHDAY=15,16;BYMONTH=1;BYDAY=MO;COUNT=4'),
    ]),
  },
  {
    name: 'rr28',
    run: expandAll([
      T('FREQ=YEARLY;BYMONTH=11;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=4'),
      T('FREQ=YEARLY;BYDAY=MO;BYSETPOS=-1;COUNT=3'),
      T('FREQ=YEARLY;BYDAY=MO;BYSETPOS=1,52;COUNT=5'),
      T('FREQ=YEARLY;BYDAY=MO;BYSETPOS=53;COUNT=3'),
      T('FREQ=YEARLY;BYMONTH=1,2;BYMONTHDAY=1;BYSETPOS=2;COUNT=3'),
      T('FREQ=YEARLY;BYMONTH=1,2,3;BYMONTHDAY=1,-1;BYSETPOS=1,-1;COUNT=6'),
      T('FREQ=YEARLY;BYMONTHDAY=1,15;BYSETPOS=3,-3;COUNT=6'),
      T('FREQ=YEARLY;BYSETPOS=1;BYMONTH=2;BYMONTHDAY=29;COUNT=3', '20240229T090000Z'),
      T('FREQ=YEARLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=260,261,-260,-261;COUNT=8', '20240101T090000Z'),
      T('FREQ=YEARLY;BYMONTH=5;BYDAY=SA,SU;BYSETPOS=1,-1;COUNT=4'),
    ]),
  },
  {
    name: 'rr29',
    run: expandAll([
      T('FREQ=DAILY;UNTIL=20240102'),
      T('FREQ=DAILY;UNTIL=20240103T090000Z'),
      T('FREQ=DAILY;UNTIL=20240103T085959Z'),
      T('FREQ=DAILY;UNTIL=20240103T090001Z'),
      T('FREQ=DAILY;UNTIL=20240103T000000Z'),
      T('FREQ=DAILY;UNTIL=20240103T235959Z'),
      T('FREQ=DAILY;UNTIL=20240103'),
      T('FREQ=DAILY;UNTIL=20240101'),
      T('FREQ=DAILY;UNTIL=20240101T090000Z'),
      T('FREQ=DAILY;UNTIL=20240101', '20240101T235959Z'),
      T('FREQ=WEEKLY;UNTIL=20240201T090000Z;BYDAY=TH'),
      T('FREQ=WEEKLY;UNTIL=20240201;BYDAY=TH', '20240101T090000Z'),
      T('FREQ=MONTHLY;UNTIL=20240630T090000Z', '20240131T090000Z'),
      T('FREQ=MONTHLY;UNTIL=20240531T090000Z', '20240131T090000Z'),
      T('FREQ=MONTHLY;UNTIL=20240530T235959Z', '20240131T090000Z'),
      T('FREQ=MONTHLY;UNTIL=20241231', '20240131T235959Z'),
      T('FREQ=YEARLY;UNTIL=20290101'),
      T('FREQ=YEARLY;UNTIL=29991231T235959Z', '29971231T000000Z'),
      T('FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13;UNTIL=20250101'),
    ]),
  },
  {
    name: 'rr30',
    run: expandAll([
      [T('FREQ=DAILY;COUNT=5', START, '20240102T090000Z', '20240104')],
      [T('FREQ=DAILY;COUNT=3', START, '20240101T090000Z', '20240102T090000Z', '20240103T090000Z')],
      [T('FREQ=DAILY;COUNT=3', START, '20231231', '20240201T090000Z', '20240102T091500Z')],
      [T('FREQ=DAILY;COUNT=3', START, '20240103T090000Z,20240101T090000Z', '20240103T090000Z,20240103')],
      [T('FREQ=DAILY;COUNT=4', START, '20240101,20240101,20240102')],
      [T('FREQ=DAILY;COUNT=4', START, '20240101T090000Z\nEXDATE:20240102T090000Z\nEXDATE:20240103')],
      [T('FREQ=DAILY;COUNT=4', START, '20240102T090000Z')],
      [T('FREQ=DAILY;COUNT=4', '20240101T000000Z', '20240101T000000Z', '20240102')],
      [T('FREQ=DAILY;COUNT=3', '20240101T235959Z', '20240102T235959Z')],
      [T('FREQ=MONTHLY;COUNT=5', '20240131T090000Z', '20240331')],
      [T('FREQ=MONTHLY;COUNT=3', '20240131T090000Z', '20240229', '20240131')],
      [T('FREQ=WEEKLY;BYDAY=MO,TU;COUNT=6', START, '20240102,20240108,20240109T090000Z')],
    ].map(([text]) => text)),
  },
  {
    name: 'rr31',
    run: expandAll([
      [T('FREQ=DAILY;COUNT=30'), { from: '20240110T090000Z', to: '20240112T090000Z' }],
      [T('FREQ=DAILY;COUNT=30'), { from: '20240110T090001Z', to: '20240112T085959Z' }],
      [T('FREQ=DAILY;COUNT=5'), { from: '20230101T000000Z' }],
      [T('FREQ=DAILY;COUNT=5'), { to: '20230101T000000Z' }],
      [T('FREQ=DAILY;COUNT=5'), { from: '20240104T000000Z' }],
      [T('FREQ=DAILY;COUNT=5'), { from: '20240106T000000Z' }],
      [T('FREQ=DAILY;COUNT=5'), { from: '20240103T090000Z', to: '20240102T090000Z' }],
      [T('FREQ=DAILY'), { limit: 3 }],
      [T('FREQ=DAILY'), { limit: 3, from: '20240201T000000Z' }],
      [T('FREQ=DAILY;COUNT=10'), { limit: 3, from: '20240108T000000Z' }],
      [T('FREQ=DAILY;COUNT=10'), { limit: 20 }],
      [T('FREQ=DAILY;COUNT=10', START, '20240102', '20240103'), { limit: 3 }],
      [T('FREQ=DAILY;COUNT=10', START, '20240102', '20240103'), { limit: 3, from: '20240105T000000Z', to: '20240108T235959Z' }],
      [T('FREQ=DAILY;COUNT=3'), { limit: 1 }],
      [T('FREQ=DAILY;UNTIL=20240110'), { limit: 4, to: '20240106T090000Z' }],
      [T('FREQ=DAILY;UNTIL=20240110'), { to: '20240120T090000Z' }],
      [T('FREQ=MONTHLY;BYMONTHDAY=31'), { limit: 5, from: '20250101T000000Z' }],
      [T('FREQ=WEEKLY;BYDAY=MO;COUNT=3'), { from: '20240101T090000Z', to: '20240101T090000Z' }],
      [T('FREQ=WEEKLY;BYDAY=MO;COUNT=3'), { from: '20240101T090001Z', to: '20240101T090001Z' }],
      [T('FREQ=YEARLY;COUNT=5'), { limit: 100000, from: '20260101T000000Z' }],
    ]),
  },
  {
    name: 'rr32',
    run: expandAll([
      T('FREQ=DAILY;COUNT=10', '29991225T090000Z'),
      T('FREQ=DAILY', '29991225T090000Z'),
      T('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', '29991222T090000Z'),
      T('FREQ=WEEKLY;BYDAY=WE,TH,FR', '29991225T090000Z'),
      T('FREQ=WEEKLY;WKST=TH;BYDAY=WE,TH,FR', '29991225T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=31;COUNT=5', '29990930T090000Z'),
      T('FREQ=MONTHLY;COUNT=5', '29991115T090000Z'),
      T('FREQ=MONTHLY;BYDAY=-1FR', '29991001T090000Z'),
      T('FREQ=YEARLY', '29980101T090000Z'),
      T('FREQ=YEARLY;INTERVAL=2', '29970101T090000Z'),
      T('FREQ=YEARLY;INTERVAL=2', '29980101T090000Z'),
      T('FREQ=DAILY', '29991231T235959Z'),
      T('FREQ=DAILY;INTERVAL=2', '29991230T235959Z'),
      T('FREQ=YEARLY;BYDAY=-1TU;COUNT=3', '29981231T090000Z'),
      T('FREQ=WEEKLY;INTERVAL=2;COUNT=10', '29991201T090000Z'),
      T('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1', '29990601T090000Z'),
    ]),
  },
  {
    name: 'rr33',
    run: expandAll([
      T('FREQ=WEEKLY;COUNT=3', '19700101T000000Z'),
      T('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH;COUNT=6', '19700101T000000Z'),
      T('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH;COUNT=6', '19700102T000000Z'),
      T('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH,SU;WKST=TH;COUNT=6', '19700101T000000Z'),
      T('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH,SU;WKST=SU;COUNT=6', '19700101T000000Z'),
      T('FREQ=MONTHLY;BYDAY=-1TH;COUNT=3', '19700101T000000Z'),
      T('FREQ=YEARLY;BYDAY=1TH;COUNT=3', '19700101T000000Z'),
      T('FREQ=YEARLY;BYDAY=-1TH;COUNT=3', '19700101T000000Z'),
      T('FREQ=DAILY;BYDAY=WE;COUNT=3', '19700101T000000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3', '19700101T000000Z'),
      T('FREQ=YEARLY;BYDAY=MO;BYSETPOS=1;COUNT=3', '19700101T000000Z'),
      T('FREQ=WEEKLY;BYDAY=TH;UNTIL=19700115T000000Z', '19700101T000000Z'),
    ]),
  },
  {
    name: 'rr34',
    run: expandAll([
      T('FREQ=WEEKLY;BYDAY=MO;COUNT=3', '21000222T090000Z'),
      T('FREQ=DAILY;COUNT=5', '21000227T000000Z'),
      T('FREQ=MONTHLY;BYDAY=-1FR;COUNT=4', '21000101T090000Z'),
      T('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1;COUNT=3', '21000101T090000Z'),
      T('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1;COUNT=3', '23000101T090000Z'),
      T('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1;COUNT=3', '23990101T090000Z'),
      T('FREQ=YEARLY;BYDAY=9TU;COUNT=2', '21000101T090000Z'),
      T('FREQ=YEARLY;BYDAY=-9TU;COUNT=3', '23990101T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=29;COUNT=4', '21000101T090000Z'),
      T('FREQ=MONTHLY;BYMONTHDAY=29;COUNT=4', '20000101T090000Z'),
      T('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=4', '20980101T090000Z'),
      T('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=4', '23980101T090000Z'),
      T('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', '29900101T090000Z'),
    ]),
  },
  {
    name: 'rr35',
    run: expandAll([
      T('FREQ=DAILY;COUNT=3', '20240101T235959Z'),
      T('FREQ=DAILY;COUNT=3', '20240101T000000Z'),
      T('FREQ=DAILY;COUNT=3', '20240101T123456Z'),
      T('FREQ=DAILY;UNTIL=20240102T235958Z', '20240101T235959Z'),
      T('FREQ=DAILY;UNTIL=20240102T235959Z', '20240101T235959Z'),
      T('FREQ=DAILY;UNTIL=20240102T000000Z', '20240101T000000Z'),
      T('FREQ=MONTHLY;COUNT=3', '20240131T235959Z'),
      T('FREQ=YEARLY;COUNT=3', '20240229T000000Z'),
      [T('FREQ=DAILY;COUNT=3', '20240101T235959Z', '20240102T235959Z,20240103T235958Z')],
      [T('FREQ=DAILY;COUNT=3', '20240101T010203Z', '20240102T010203Z')],
      [T('FREQ=DAILY;COUNT=3', '20240101T010203Z'), { from: '20240102T010203Z', to: '20240102T010203Z' }],
    ]),
  },
  {
    name: 'rr36',
    run: expandAll([
      T('FREQ=DAILY;BYMONTH=6,7;COUNT=5', '20240528T090000Z'),
      T('FREQ=WEEKLY;BYMONTH=6;COUNT=6', '20240525T090000Z'),
      T('FREQ=MONTHLY;BYMONTH=2;BYDAY=SU;COUNT=6', '20240101T090000Z'),
      T('FREQ=MONTHLY;BYMONTH=2;COUNT=3', '20240229T090000Z'),
      T('FREQ=WEEKLY;INTERVAL=2;BYMONTH=1;BYDAY=MO;COUNT=6', '20240101T090000Z'),
      T('FREQ=DAILY;BYMONTH=1;BYMONTHDAY=31;UNTIL=20270101', '20240101T090000Z'),
      T('FREQ=DAILY;BYDAY=MO;BYMONTH=12;COUNT=6', '20240101T090000Z'),
      T('FREQ=DAILY;INTERVAL=30;BYMONTHDAY=1;COUNT=3', '20240101T090000Z'),
      T('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=1'),
      T('FREQ=MONTHLY;INTERVAL=3;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=5', '20240131T090000Z'),
    ]),
  },
  {
    name: 'rr37',
    run: async ({ load }) => {
      const { expand } = await lib(load);
      const random = prng(20240229);
      const lines = [];
      for (let index = 0; index < 60; index += 1) {
        const { text } = randomRule(random);
        lines.push(`${index}| ${show(attempt(() => expand(text, { limit: 15 })))}`);
      }
      return lines;
    },
  },
  {
    name: 'rr38',
    run: async ({ load }) => {
      const { expand } = await lib(load);
      const random = prng(1970);
      const lines = [];
      for (let index = 0; index < 60; index += 1) {
        const { text, year, int } = randomRule(random);
        const options = { limit: int(1, 8) };
        if (random() < 0.5) options.from = `${year + int(0, 3)}${pad(int(1, 12))}${pad(int(1, 28))}T000000Z`;
        if (random() < 0.3) options.to = `${year + int(2, 6)}${pad(int(1, 12))}${pad(int(1, 28))}T235959Z`;
        lines.push(`${index}| ${show(attempt(() => expand(text, options)))}`);
      }
      return lines;
    },
  },
  {
    name: 'rr39',
    run: async ({ load }) => {
      const { parse } = await lib(load);
      const random = prng(5);
      const bases = [
        'DTSTART:20240115T093000Z\nRRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=10;BYMONTHDAY=-1,15;BYDAY=2TU;BYSETPOS=1;WKST=SU\nEXDATE:20240303,20240102T090000Z',
        'DTSTART:20240115T093000Z\nRRULE:FREQ=YEARLY;UNTIL=20301231T235959Z;BYMONTH=1,2;BYDAY=-1FR,MO',
        'DTSTART:20240115T093000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU;COUNT=5\r\n',
      ];
      // Mostly glyphs that keep the shape of the text, so that many mutants still parse and show the normalization.
      const glyphs = [',', '-', '+', '0', '1', '9', '5', 'A', 'T', 'Z', 'O', 'M', 'U', '3', '2', '7', ',', '-', '1', '2', ';', '=', ' ', ':', '\n'];
      const lines = [];
      for (let index = 0; index < 60; index += 1) {
        const base = bases[index % bases.length];
        const at = Math.floor(random() * base.length);
        const mode = random();
        const glyph = glyphs[Math.floor(random() * glyphs.length)];
        const text = mode < 0.5 ? base.slice(0, at) + glyph + base.slice(at + 1) : mode < 0.75 ? base.slice(0, at) + base.slice(at + 1) : base.slice(0, at) + glyph + base.slice(at);
        lines.push(`${index}| ${show(attempt(() => parse(text)))}`);
      }
      return lines;
    },
  },
  {
    name: 'rr40',
    run: async ({ load }) => {
      const { expand } = await lib(load);
      const rules = [
        T('FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30'),
        T('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'),
        T('FREQ=MONTHLY;BYMONTH=4;BYMONTHDAY=31'),
        T('FREQ=DAILY;INTERVAL=7;BYDAY=TU'),
        T('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYMONTH=2;BYSETPOS=3'),
        T('FREQ=DAILY;BYMONTHDAY=29;BYMONTH=2;INTERVAL=3', '20240229T000000Z'),
        T('FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=29;BYMONTH=2;COUNT=999999999'),
        T('FREQ=DAILY;BYMONTH=2;BYMONTHDAY=-30'),
      ];
      return chunks([2, 4, 8], 2500, (size) => rules.slice(0, size).map((text) => show(expand(text, { limit: 100000 }))).join(' '));
    },
  },
  {
    name: 'rr41',
    run: async ({ load }) => {
      const { expand } = await lib(load);
      return chunks([1000, 10000, 100000], 1500, (size) => summary(expand(T(`FREQ=DAILY;COUNT=${size}`, '19700101T000000Z'), { limit: 100000 })));
    },
  },
  {
    name: 'rr42',
    run: async ({ load }) => {
      const { expand } = await lib(load);
      return chunks([2000, 10000, 40000], 700, (size, text) => summary(expand(text, { limit: 100000 })), (size) => {
        const base = Date.UTC(2000, 0, 1, 9);
        const items = [];
        for (let day = 0; day < size; day += 1) items.push(isoOf(base + 2 * day * DAY));
        const lines = [];
        for (let at = 0; at < items.length; at += 5000) lines.push(`EXDATE:${items.slice(at, at + 5000).join(',')}`);
        return ['DTSTART:20000101T090000Z', `RRULE:FREQ=DAILY;COUNT=${size * 2 + 7}`, ...lines.reverse()].join('\n');
      });
    },
  },
  {
    name: 'rr43',
    run: async ({ load }) => {
      const { parse } = await lib(load);
      return chunks([2000, 10000, 40000], 700, (size, text) => {
        const result = parse(text);
        return `${result.exdates.length} ${result.exdates[0]} ${result.exdates[result.exdates.length - 1]}`;
      }, (size) => {
        const base = Date.UTC(1990, 0, 1, 9);
        const items = [];
        for (let n = 0; n < size; n += 1) items.push(isoOf(base + ((n * 7919) % size) * DAY));
        items.push(...items.slice(0, 50));
        return `DTSTART:19900101T090000Z\nRRULE:FREQ=DAILY\nEXDATE:${items.join(',')}`;
      });
    },
  },
  {
    name: 'rr44',
    run: async ({ load }) => {
      const { expand } = await lib(load);
      const rules = [
        ['FREQ=YEARLY;BYDAY=MO,TU,WE,TH,FR', 'weekdays'],
        ['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'last weekday'],
        ['FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2', 'weekly'],
        ['FREQ=MONTHLY;BYMONTHDAY=1,15,-1', 'month days'],
      ];
      return chunks([1000, 10000, 100000], 2500, (limit) => rules.map(([rule]) => summary(expand(T(rule, '19700101T000000Z'), { limit }))).join(' / '));
    },
  },
];
