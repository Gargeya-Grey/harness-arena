import { RRuleError } from './errors.mjs';
import { MAX_YEAR, daysFromCivil, formatBasic, readBasic } from './dates.mjs';
import { parse } from './rule.mjs';
import { candidateDays, effectiveParts, periodAt } from './candidates.mjs';

const MAX_DAY = daysFromCivil(MAX_YEAR, 12, 31);
const keyOf = (days, seconds) => days * 86400 + seconds;

function readOptions(options) {
  if (options === null || typeof options !== 'object') throw new RRuleError('options must be an object');
  const limit = options.limit === undefined ? 1000 : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) throw new RRuleError('bad limit');
  const bound = (name) => {
    if (options[name] === undefined) return null;
    const read = typeof options[name] === 'string' ? readBasic(options[name]) : null;
    if (!read) throw new RRuleError(`bad ${name}`);
    return keyOf(read.days, read.seconds);
  };
  return { limit, from: bound('from'), to: bound('to') };
}

export function expand(text, options = {}) {
  const { dtstart, rule, exdates } = parse(text);
  const { limit, from, to } = readOptions(options);
  const start = readBasic(dtstart);
  const parts = effectiveParts(rule, start.days);
  const excludedMoments = new Set();
  const excludedDays = new Set();
  for (const item of exdates) {
    if (item.length === 8) excludedDays.add(readBasic(item, true).days);
    else {
      const moment = readBasic(item);
      excludedMoments.add(keyOf(moment.days, moment.seconds));
    }
  }
  let untilKey = Infinity;
  let untilDay = Infinity;
  if (rule.until !== null && rule.until.length === 8) untilDay = readBasic(rule.until, true).days;
  else if (rule.until !== null) {
    const until = readBasic(rule.until);
    untilKey = keyOf(until.days, until.seconds);
  }

  const out = [];
  let generated = 0;
  for (let k = 0; ; k += 1) {
    const period = periodAt(rule, start.days, k);
    if (period.first > MAX_DAY) return out;
    for (const day of candidateDays(rule, parts, period)) {
      if (day < start.days) continue;
      if (day > MAX_DAY || day > untilDay) return out;
      const key = keyOf(day, start.seconds);
      if (key > untilKey || (to !== null && key > to)) return out;
      generated += 1;
      if (!excludedMoments.has(key) && !excludedDays.has(day) && (from === null || key >= from)) {
        out.push(formatBasic(day, start.seconds));
        if (out.length === limit) return out;
      }
      if (generated === rule.count) return out;
    }
  }
}
