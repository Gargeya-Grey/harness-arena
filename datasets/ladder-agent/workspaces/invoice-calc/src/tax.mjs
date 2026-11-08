import { roundDiv } from './rounding.mjs';

// Splits each amount (after the discounts) into net and tax. A rate is in basis points.
// Prices without tax: tax = amount * rate. Prices with tax: tax = amount * rate / (10000 + rate) rounded, and
// net = amount - tax, so net + tax is the amount.
// Every line is rounded on its own.
export function splitTax(amounts, rates, { inclusive, rounding }) {
  return amounts.map((amount, index) => {
    const rate = rates[index];
    if (!inclusive) return { net: amount, tax: roundDiv(amount * rate, 10_000, rounding) };
    const tax = roundDiv(amount * rate, 10_000 + rate);
    return { net: amount - tax, tax };
  });
}

// [{ rate, taxable, tax }] for the rates that are used, lowest rate first.
export function taxSummary(lines) {
  const groups = new Map();
  for (const line of lines) {
    const group = groups.get(line.rate) ?? { rate: line.rate, taxable: 0, tax: 0 };
    group.taxable += line.net;
    group.tax += line.tax;
    groups.set(line.rate, group);
  }
  return [...groups.values()].sort((a, b) => a.rate - b.rate);
}
