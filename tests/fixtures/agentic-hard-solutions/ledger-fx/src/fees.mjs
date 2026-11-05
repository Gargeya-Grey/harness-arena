// A fee schedule is { bps, flat }: a percentage in basis points of the amount
// plus a flat fee, both in minor units of the sender's currency. The
// percentage is rounded to a whole minor unit, halves away from zero.
export function feeFor(amount, schedule = {}) {
  const { bps = 0, flat = 0 } = schedule;
  const scaled = amount * bps;
  const rounded = Math.floor((2 * Math.abs(scaled) + 10000) / 20000);
  return (scaled < 0 ? -rounded : rounded) + flat;
}
