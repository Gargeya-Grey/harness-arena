// Splits `total` minor units over `weights` in proportion. The shares add up to
// `total` exactly: each share is rounded down, and the units left over go one by
// one to the largest remainders (the earlier index wins a tie).
export function allocate(total, weights) {
  if (!weights.length) throw new Error('nothing to allocate to');
  if (!Number.isInteger(total)) throw new Error('total must be an integer');
  if (!weights.every((w) => Number.isInteger(w) && w >= 0)) throw new Error('weights must be non-negative integers');
  const sum = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (sum <= 0n) throw new Error('weights must add up to more than zero');
  const magnitude = BigInt(Math.abs(total));
  const shares = weights.map((w) => (magnitude * BigInt(w)) / sum);
  const remainders = weights.map((w, index) => ({ index, rem: (magnitude * BigInt(w)) % sum }));
  let left = Number(magnitude - shares.reduce((a, b) => a + b, 0n));
  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  const out = shares.map(Number);
  for (const { index } of remainders) {
    if (left === 0) break;
    out[index] += 1;
    left -= 1;
  }
  return total < 0 ? out.map((n) => (n === 0 ? 0 : -n)) : out;
}
