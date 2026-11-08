// A fee schedule is { bps, flat }: a percentage in basis points of the amount
// plus a flat fee, both in minor units of the sender's currency.
export function feeFor(amount, schedule = {}) {
  const { bps = 0, flat = 0 } = schedule;
  return Math.floor((amount * bps) / 10000) + flat;
}
