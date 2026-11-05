// Converts an amount in minor units of `from` into minor units of `to`.
export function convert(minor, from, to, rates) {
  if (from === to) return minor;
  const leg = (amount, a, b) => Math.round(amount * rates.rate(a, b));
  if (rates.has(from, to)) return leg(minor, from, to);
  return leg(leg(minor, from, rates.pivot), rates.pivot, to);
}
