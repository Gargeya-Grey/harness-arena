// Amounts as people write them: 12.5, -3, +7, .5, 1,234.50, $1,234.50, -$5,
// €9.99, £3, (12.00) for -12.00. Anything else is not an amount.
const AMOUNT = /^([+-])?\s*[$€£]?\s*(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d+))?$/;

// An exact decimal: { units, scale } stands for units / 10^scale. Null when the text is no amount.
export function parseAmount(text) {
  let body = String(text).trim();
  let negative = false;
  const parenthesised = /^\((.*)\)$/.exec(body);
  if (parenthesised) {
    negative = true;
    body = parenthesised[1].trim();
  }
  const match = AMOUNT.exec(body);
  if (!match) return null;
  if (parenthesised && match[1]) return null;
  const whole = match[2].replace(/,/g, '');
  const fraction = match[3] ?? '';
  if (whole === '' && fraction === '') return null;
  const units = BigInt(whole + fraction);
  return { units: negative || match[1] === '-' ? -units : units, scale: fraction.length };
}

export function decimalToNumber({ units, scale }) {
  return Number(units) / 10 ** scale;
}

// The amount as a number, or null.
export function toNumber(text) {
  const amount = parseAmount(text);
  return amount === null ? null : decimalToNumber(amount);
}
