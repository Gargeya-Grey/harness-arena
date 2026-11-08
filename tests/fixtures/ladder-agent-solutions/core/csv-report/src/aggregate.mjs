import { decimalToNumber } from './coerce.mjs';

const scaleTo = (amount, scale) => amount.units * 10n ** BigInt(scale - amount.scale);

function compare(a, b) {
  const scale = Math.max(a.scale, b.scale);
  const x = scaleTo(a, scale);
  const y = scaleTo(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

// One group of rows. add() takes a parsed amount, or null for a row without one.
// count is every row; sum, avg, min and max use the rows that have an amount.
export function createGroup() {
  let count = 0;
  let numeric = 0;
  let sum = { units: 0n, scale: 0 };
  let min = null;
  let max = null;
  return {
    add(amount) {
      count += 1;
      if (amount === null) return;
      numeric += 1;
      const scale = Math.max(sum.scale, amount.scale);
      sum = { units: scaleTo(sum, scale) + scaleTo(amount, scale), scale };
      if (min === null || compare(amount, min) < 0) min = amount;
      if (max === null || compare(amount, max) > 0) max = amount;
    },
    result() {
      return {
        count,
        sum: decimalToNumber(sum),
        avg: numeric === 0 ? null : Number(sum.units) / (10 ** sum.scale * numeric),
        min: min === null ? null : decimalToNumber(min),
        max: max === null ? null : decimalToNumber(max),
      };
    },
  };
}
