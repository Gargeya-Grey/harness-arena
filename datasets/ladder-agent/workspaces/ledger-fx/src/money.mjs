// Money is always an integer count of minor units (cents, yen, fils) plus a
// currency code. The table holds the number of minor-unit digits per currency.
export const CURRENCIES = { USD: 2, EUR: 2, GBP: 2, CHF: 2, JPY: 0, KWD: 3, BHD: 3 };

export function exponent(code) {
  if (!Object.hasOwn(CURRENCIES, code)) throw new Error(`unknown currency ${code}`);
  return CURRENCIES[code];
}

// '12.34' -> 1234. Rejects more decimals than the currency has.
export function toMinor(text, code) {
  const digits = exponent(code);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(text).trim());
  if (!match) throw new Error(`bad amount ${text}`);
  const fraction = match[3] ?? '';
  if (fraction.length > digits) throw new Error(`too many decimals for ${code}: ${text}`);
  const minor = Number(match[2] + fraction.padEnd(digits, '0'));
  return match[1] && minor !== 0 ? -minor : minor;
}

// 1234 -> '12.34 USD'
export function format(minor, code) {
  const digits = exponent(code);
  if (digits === 0) return `${minor} ${code}`;
  const scale = 10 ** digits;
  const whole = Math.trunc(minor / scale);
  const fraction = Math.abs(minor % scale);
  return `${whole}.${String(fraction).padStart(digits, '0')} ${code}`;
}
