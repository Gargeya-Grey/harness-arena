import { exponent } from './money.mjs';

// Half away from zero, for BigInt n / d with d > 0.
function divideRound(n, d) {
  const abs = n < 0n ? -n : n;
  const q = (2n * abs + d) / (2n * d);
  return n < 0n ? -q : q;
}

// Converts an amount in minor units of `from` into minor units of `to`.
// The rate is an exact fraction, so there is one rounding, at the very end.
export function convert(minor, from, to, rates) {
  if (from === to) return minor;
  const { num, den } = rates.ratio(from, to);
  const up = 10n ** BigInt(exponent(to));
  const down = 10n ** BigInt(exponent(from));
  return Number(divideRound(BigInt(minor) * num * up, den * down));
}
