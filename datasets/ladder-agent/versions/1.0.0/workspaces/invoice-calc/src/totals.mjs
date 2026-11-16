import { currencyInfo } from './currency.mjs';
import { roundDiv } from './rounding.mjs';

const sum = (lines, key) => lines.reduce((a, line) => a + line[key], 0);

// subtotal: amounts before discounts. discount: all discounts. net: amounts without tax. tax. total: net + tax.
// With cashRounding (CHF only) the amount due is the total rounded to the nearest 5 minor units, a tie going
// up, whatever the rounding mode of the invoice. `rounding` is due - total.
export function invoiceTotals(lines, { currency, cashRounding }) {
  const total = sum(lines, 'total');
  let due = total;
  if (cashRounding) {
    const step = currencyInfo(currency).cashStep ?? 5;
    due = roundDiv(total, step, 'half-up') * step;
  }
  return {
    subtotal: sum(lines, 'gross'),
    discount: sum(lines, 'discount'),
    net: sum(lines, 'net'),
    tax: sum(lines, 'tax'),
    total,
    rounding: due - total,
    due,
  };
}
