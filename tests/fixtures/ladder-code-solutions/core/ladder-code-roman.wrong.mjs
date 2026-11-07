function toRoman(n) {
  const table = [[1000, 'M'], [500, 'D'], [100, 'C'], [50, 'L'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [value, symbol] of table) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}
