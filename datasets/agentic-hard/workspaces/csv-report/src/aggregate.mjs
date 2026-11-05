// One group of rows. add() takes the amount of a row, or null for a row without one.
export function createGroup() {
  let count = 0;
  let sum = 0;
  let min = null;
  let max = null;
  return {
    add(amount) {
      count += 1;
      const value = amount ?? 0;
      sum += value;
      min = min === null ? value : Math.min(min, value);
      max = max === null ? value : Math.max(max, value);
    },
    result() {
      return { count, sum, avg: count === 0 ? null : sum / count, min, max };
    },
  };
}
