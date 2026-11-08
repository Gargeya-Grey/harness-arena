import { allocate } from './allocate.mjs';
import { roundDiv } from './rounding.mjs';

// Splits each amount (after all discounts) into net and tax. A rate is in basis points.
// Prices without tax: tax = amount * rate. Prices with tax: net = amount * 10000 / (10000 + rate) rounded, and
// tax = amount - net, so net + tax is the amount.
// taxMode 'line': every line is rounded on its own. taxMode 'invoice': the amounts of one rate are added up,
// rounded once, and the tax of the group is shared among its lines in proportion to their amounts.
export function splitTax(amounts, rates, { inclusive, taxMode, rounding }) {
  const split = (amount, rate) => {
    if (!inclusive) return { net: amount, tax: roundDiv(amount * rate, 10_000, rounding) };
    const net = roundDiv(amount * 10_000, 10_000 + rate, rounding);
    return { net, tax: amount - net };
  };
  if (taxMode === 'line') return amounts.map((amount, index) => split(amount, rates[index]));

  const result = amounts.map((amount) => ({ net: amount, tax: 0 }));
  for (const rate of new Set(rates)) {
    const members = amounts.map((_, index) => index).filter((index) => rates[index] === rate);
    const sum = members.reduce((a, index) => a + amounts[index], 0);
    const shares = allocate(split(sum, rate).tax, members.map((index) => amounts[index]));
    members.forEach((index, position) => {
      result[index].tax = shares[position];
      result[index].net = amounts[index] - (inclusive ? shares[position] : 0);
    });
  }
  return result;
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
