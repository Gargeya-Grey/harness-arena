// 1234.5 with decimals 2 and thousands ',' -> '1,234.50'.
// NaN and infinity are written as they are.
export function formatNumber(value, { decimals = 0, thousands = '' } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  const fixed = value.toFixed(decimals);
  return thousands ? fixed.replace(/\B(?=(\d{3})+(?!\d))/g, thousands) : fixed;
}
