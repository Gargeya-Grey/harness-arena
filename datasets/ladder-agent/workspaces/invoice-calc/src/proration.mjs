import { roundDiv, requireSafe } from './rounding.mjs';

// The amount of a line before any discount: unit price times quantity, rounded once.
// A line with a service period is charged for the days of the period it was served, both ends included:
// the served days run from max(from, periodStart) to min(to, periodEnd); `from` and `to` are optional;
// a line served on no day of the period is 0.
export function lineGross(line, rounding) {
  const base = requireSafe(line.unitPrice * line.quantityMilli, 'line amount');
  if (!line.service) return roundDiv(base, 1000, rounding);
  const { periodStart, periodEnd, from, to } = line.service;
  const first = from ?? periodStart;
  const last = to ?? periodEnd;
  const served = last - first + 1;
  const periodDays = periodEnd - periodStart + 1;
  return roundDiv(requireSafe(base * served, 'line amount'), 1000 * periodDays, rounding);
}
