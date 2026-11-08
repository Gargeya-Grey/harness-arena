// Splits `total` minor units over `weights` in proportion.
export function allocate(total, weights) {
  if (!weights.length) throw new Error('nothing to allocate to');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('weights must add up to more than zero');
  return weights.map((weight) => Math.round((total * weight) / sum));
}
