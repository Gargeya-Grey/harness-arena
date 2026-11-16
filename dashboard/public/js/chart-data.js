// Coverage follows aggregate() in lab/lib/state.mjs. Values and intervals stay server-owned.
export function passInterval(aggregate) {
  const interval = aggregate?.pass_rate_ci;
  return Array.isArray(interval) && interval.length === 2 && interval.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) && interval[0] <= interval[1] ? interval : null;
}

export function passRangeText(aggregate) {
  const interval = passInterval(aggregate);
  if (interval) return `${Math.round(interval[0] * 100)}–${Math.round(interval[1] * 100)}%`;
  if (!aggregate?.counted_n) return 'Unavailable: no decided tries';
  if ((aggregate.cases_n || 0) < 3) return `Unavailable: ${aggregate.cases_n || 0} counted ${aggregate.cases_n === 1 ? 'case' : 'cases'}; at least 3 needed`;
  return 'Unavailable: no interval returned';
}

export function metricCoverage(storedRows) {
  const rows = storedRows.filter((row) => row.trusted !== false);
  const numeric = (v) => typeof v === 'number';
  const completed = rows.filter((row) => !row.error);
  const timed = completed.filter((row) => numeric(row.latency_ms));
  const consistent = rows.filter((row) => !row.error || row.error_class === 'failed');
  const groups = new Map();
  for (const row of consistent) {
    if (!groups.has(row.case_id)) groups.set(row.case_id, []);
    groups.get(row.case_id).push(row);
  }
  const repeated = [...groups.values()].filter((list) => list.length >= 2);
  return {
    stored: storedRows.length,
    included: rows.length,
    notCounted: storedRows.length - rows.length,
    timed: timed.length,
    timeMissing: completed.length - timed.length,
    timeNoAnswer: rows.filter((row) => row.error && row.error_class !== 'incomplete').length,
    incomplete: rows.filter((row) => row.error_class === 'incomplete').length,
    cost: rows.filter((row) => numeric(row.cost_usd)).length,
    tokens: Object.fromEntries(['input_tokens', 'output_tokens', 'cache_read_tokens'].map((key) => [key, rows.filter((row) => numeric(row.usage?.[key])).length])),
    repeatedCases: repeated.length,
    repeatedTries: repeated.reduce((n, list) => n + list.length, 0),
    consistencyExcluded: rows.length - repeated.reduce((n, list) => n + list.length, 0),
  };
}
