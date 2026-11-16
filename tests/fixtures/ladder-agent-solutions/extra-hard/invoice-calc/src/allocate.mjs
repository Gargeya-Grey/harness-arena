import { InvoiceError } from './errors.mjs';
import { requireSafe } from './rounding.mjs';

// Shares `total` among the weights, in proportion, so that the shares are whole numbers and add up to `total`
// exactly (largest remainder method). A share that is left over goes to the biggest remainders first; equal
// remainders go to the lower index. All weights 0 is only allowed for a total of 0.
export function allocate(total, weights) {
  requireSafe(total);
  if (total < 0) throw new InvoiceError('a total to allocate is 0 or more');
  weights.forEach((weight) => {
    requireSafe(weight, 'weight');
    if (weight < 0) throw new InvoiceError('a weight is 0 or more');
  });
  if (total === 0) return weights.map(() => 0);
  const sum = requireSafe(weights.reduce((a, b) => a + b, 0), 'weight sum');
  if (sum === 0) {
    if (total !== 0) throw new InvoiceError('there is nothing to allocate to');
    return weights.map(() => 0);
  }
  const parts = weights.map((weight, index) => {
    const scaled = requireSafe(total * weight, 'allocation');
    const rest = scaled % sum;
    return { index, share: (scaled - rest) / sum, rest };
  });
  let left = total - parts.reduce((a, part) => a + part.share, 0);
  const order = [...parts].sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const part of order) {
    if (left <= 0) break;
    part.share += 1;
    left -= 1;
  }
  return parts.map((part) => part.share);
}
