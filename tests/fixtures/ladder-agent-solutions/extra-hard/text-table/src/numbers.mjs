// The digits of a non-negative finite number as written in decimal, never in exponent form.
function digitsOf(abs) {
  const [mantissa, exponent = '0'] = String(abs).split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return { whole: '0', fraction: '0'.repeat(-point) + digits };
  if (point >= digits.length) return { whole: digits + '0'.repeat(point - digits.length), fraction: '' };
  return { whole: digits.slice(0, point), fraction: digits.slice(point) };
}

// 1234.5 with decimals 2 and thousands ',' -> '1,234.50'.
// Rounds half away from zero on the decimal digits of the number as it is written, so 1.005 gives 1.01 at 2 decimals.
// A result that is zero has no minus sign. NaN and infinity are written as they are.
export function formatNumber(value, { decimals = 0, thousands = '' } = {}) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 20) throw new RangeError('decimals is a whole number from 0 to 20');
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  const { whole, fraction } = digitsOf(Math.abs(value));
  const kept = BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, '0'));
  const rounded = (fraction[decimals] ?? '0') >= '5' ? kept + 1n : kept;
  const text = rounded.toString().padStart(decimals + 1, '0');
  const integer = text.slice(0, text.length - decimals);
  const tail = decimals ? `.${text.slice(-decimals)}` : '';
  const grouped = thousands ? integer.replace(/\B(?=(\d{3})+$)/g, thousands) : integer;
  const negative = value < 0 && /[1-9]/.test(text);
  return `${negative ? '-' : ''}${grouped}${tail}`;
}
