// Backoff rule: { baseMs, factor, capMs }. `retry` is 1 for the first retry.
export function normalizeBackoff(options = {}) {
  const { baseMs = 1000, factor = 2, capMs = 60_000 } = options;
  if (!(baseMs >= 0) || !(factor >= 1) || !(capMs >= 0)) throw new RangeError('baseMs and capMs must not be negative and factor must be at least 1');
  return { baseMs, factor, capMs };
}

export function backoffDelay({ baseMs, factor, capMs }, retry) {
  const raw = baseMs * factor ** (retry - 1);
  return Math.min(capMs, Math.floor(raw));
}
