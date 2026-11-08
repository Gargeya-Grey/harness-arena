import { RRuleError } from './errors.mjs';
import { WEEKDAYS, readBasic } from './dates.mjs';

const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

/** A decimal integer without leading zero; `signed` allows one + or -. Checks the size of the digits, not the sign. */
function integer(text, signed, min, max) {
  const m = (signed ? /^([+-]?)(0|[1-9]\d*)$/ : /^()(0|[1-9]\d*)$/).exec(text);
  if (!m || m[2].length > 9) return null;
  const size = Number(m[2]);
  if (size < min || size > max) return null;
  return m[1] === '-' ? -size : size;
}

/** A comma list of integers, sorted ascending without duplicates; null when any item is bad (an empty item is bad). */
function numbers(text, signed, min, max) {
  const items = text.split(',').map((item) => integer(item, signed, min, max));
  if (items.includes(null)) return null;
  return [...new Set(items)].sort((a, b) => a - b);
}

function byDay(text) {
  const entries = [];
  for (const item of text.split(',')) {
    const m = /^(?:([+-]?)([1-9]\d?))?(MO|TU|WE|TH|FR|SA|SU)$/.exec(item);
    if (!m) return null;
    const size = m[2] === undefined ? 0 : Number(m[2]);
    if (size > 53) return null;
    entries.push({ ordinal: m[1] === '-' ? -size : size, day: m[3] });
  }
  const unique = new Map(entries.map((entry) => [`${entry.day}${entry.ordinal}`, entry]));
  return [...unique.values()].sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.ordinal - b.ordinal);
}

const READERS = {
  FREQ: (v) => (FREQS.includes(v) ? v : null),
  INTERVAL: (v) => integer(v, false, 1, 9999),
  COUNT: (v) => integer(v, false, 1, 999999999),
  UNTIL: (v) => (readBasic(v) || readBasic(v, true) ? v : null),
  BYMONTH: (v) => numbers(v, false, 1, 12),
  BYMONTHDAY: (v) => numbers(v, true, 1, 31),
  BYDAY: byDay,
  BYSETPOS: (v) => numbers(v, true, 1, 366),
  WKST: (v) => (WEEKDAYS.includes(v) ? v : null),
};

function readRuleParts(value, line) {
  const parts = {};
  for (const part of value.split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) throw new RRuleError(`line ${line}: bad rule part "${part}"`);
    const name = part.slice(0, at);
    const text = part.slice(at + 1);
    if (!Object.hasOwn(READERS, name)) throw new RRuleError(`line ${line}: unknown rule part ${name}`);
    if (Object.hasOwn(parts, name)) throw new RRuleError(`line ${line}: duplicate rule part ${name}`);
    const read = READERS[name](text);
    if (read === null) throw new RRuleError(`line ${line}: bad ${name} "${text}"`);
    parts[name] = read;
  }
  return parts;
}

function checkRule(rule, dtstart) {
  if (rule.freq === null) throw new RRuleError('FREQ is required');
  if (rule.count !== null && rule.until !== null) throw new RRuleError('COUNT and UNTIL cannot both be set');
  if (rule.freq === 'WEEKLY' && rule.bymonthday.length) throw new RRuleError('BYMONTHDAY cannot be used with FREQ=WEEKLY');
  const ordinals = rule.byday.filter((entry) => entry.ordinal !== 0);
  if (ordinals.length && (rule.freq === 'DAILY' || rule.freq === 'WEEKLY')) throw new RRuleError('BYDAY ordinals need FREQ=MONTHLY or FREQ=YEARLY');
  const limit = rule.freq === 'YEARLY' && !rule.bymonth.length ? 53 : 5;
  if (ordinals.some((entry) => Math.abs(entry.ordinal) > limit)) throw new RRuleError('BYDAY ordinal out of range');
  if (rule.bysetpos.length && !rule.bymonth.length && !rule.bymonthday.length && !rule.byday.length) throw new RRuleError('BYSETPOS needs another BY part');
  if (rule.until !== null) {
    const date = rule.until.length === 8;
    const until = readBasic(rule.until, date);
    const before = date ? until.days < dtstart.days : until.days * 86400 + until.seconds < dtstart.days * 86400 + dtstart.seconds;
    if (before) throw new RRuleError('UNTIL is before DTSTART');
  }
}

export function parse(text) {
  if (typeof text !== 'string') throw new RRuleError('input must be a string');
  let dtstart = null;
  let dtstartText = null;
  let parts = null;
  const exdates = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line === '') return;
    const n = index + 1;
    const m = /^([A-Z]+):([\s\S]*)$/.exec(line);
    if (!m) throw new RRuleError(`line ${n}: expected NAME:VALUE`);
    const [, name, value] = m;
    if (name === 'DTSTART') {
      if (dtstartText !== null) throw new RRuleError(`line ${n}: duplicate DTSTART`);
      dtstart = readBasic(value);
      if (!dtstart) throw new RRuleError(`line ${n}: bad DTSTART "${value}"`);
      dtstartText = value;
    } else if (name === 'RRULE') {
      if (parts !== null) throw new RRuleError(`line ${n}: duplicate RRULE`);
      parts = readRuleParts(value, n);
    } else if (name === 'EXDATE') {
      for (const item of value.split(',')) {
        if (!readBasic(item) && !readBasic(item, true)) throw new RRuleError(`line ${n}: bad EXDATE "${item}"`);
        if (!exdates.includes(item)) exdates.push(item);
      }
    } else {
      throw new RRuleError(`line ${n}: unknown property ${name}`);
    }
  });
  if (dtstartText === null) throw new RRuleError('missing DTSTART');
  if (parts === null) throw new RRuleError('missing RRULE');
  const rule = {
    freq: parts.FREQ ?? null,
    interval: parts.INTERVAL ?? 1,
    count: parts.COUNT ?? null,
    until: parts.UNTIL ?? null,
    bymonth: parts.BYMONTH ?? [],
    bymonthday: parts.BYMONTHDAY ?? [],
    byday: parts.BYDAY ?? [],
    bysetpos: parts.BYSETPOS ?? [],
    wkst: parts.WKST ?? 'MO',
  };
  checkRule(rule, dtstart);
  return { dtstart: dtstartText, rule, exdates: exdates.sort() };
}
