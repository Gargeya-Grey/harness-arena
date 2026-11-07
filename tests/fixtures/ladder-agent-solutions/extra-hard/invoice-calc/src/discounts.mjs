import { allocate } from './allocate.mjs';
import { roundDiv } from './rounding.mjs';

// The discount of one line, taken from its own amount. Never more than the amount.
export function lineDiscount(discount, gross, rounding) {
  if (!discount) return 0;
  if (discount.percentBp !== undefined) return roundDiv(gross * discount.percentBp, 10_000, rounding);
  return Math.min(discount.amount, gross);
}

// The invoice discount, shared out over the lines. `nets` are the line amounts after their own discounts.
// Only discountable lines count and only they get a share. The discount is worked out on the sum of those
// amounts: nothing when the sum is below minSubtotal (equal is enough); a percentage is rounded; a fixed amount
// is never more than the sum; cap, when given, limits either kind. The shares add up to the discount exactly.
export function invoiceDiscount(discount, nets, discountable, rounding) {
  const weights = nets.map((net, index) => (discountable[index] ? net : 0));
  const base = weights.reduce((a, b) => a + b, 0);
  if (!discount || base < discount.minSubtotal) return { total: 0, shares: nets.map(() => 0) };
  let total = discount.percentBp !== undefined ? roundDiv(base * discount.percentBp, 10_000, rounding) : Math.min(discount.amount, base);
  if (discount.cap !== undefined) total = Math.min(total, discount.cap);
  return { total, shares: allocate(total, weights) };
}
