import { exponent } from './money.mjs';

// Converts an amount in minor units of `from` into minor units of `to`.
export function convert(minor, from, to, rates) {
  if (from === to) return minor;
  const scale = 10 ** (exponent(to) - exponent(from));
  const leg = (amount, a, b, scaleBy) => Math.round(amount * rates.rate(a, b) * scaleBy);
  if (rates.has(from, to)) return leg(minor, from, to, scale);
  return leg(leg(minor, from, rates.pivot, 10 ** (exponent(rates.pivot) - exponent(from))), rates.pivot, to, 10 ** (exponent(to) - exponent(rates.pivot)));
}
