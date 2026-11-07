import { InvoiceError } from './errors.mjs';

export const MODES = ['half-up', 'half-even'];

export function requireSafe(value, what = 'amount') {
  if (!Number.isSafeInteger(value)) throw new InvoiceError(`${what} is not a whole number that fits`);
  return value;
}

// n / d rounded to a whole number, with integer arithmetic only. d is above 0.
// A tie goes away from zero for 'half-up' and to the even number for 'half-even'.
export function roundDiv(n, d, mode = 'half-up') {
  requireSafe(n);
  requireSafe(d, 'divisor');
  if (d <= 0) throw new InvoiceError('the divisor is above 0');
  if (!MODES.includes(mode)) throw new InvoiceError(`unknown rounding ${String(mode)}`);
  const abs = Math.abs(n);
  const rest = abs % d;
  const whole = (abs - rest) / d;
  let result = whole;
  if (rest > d - rest) result = whole + 1;
  else if (rest === d - rest) result = mode === 'half-even' && whole % 2 === 0 ? whole : whole + 1;
  return n < 0 && result !== 0 ? -result : result;
}
