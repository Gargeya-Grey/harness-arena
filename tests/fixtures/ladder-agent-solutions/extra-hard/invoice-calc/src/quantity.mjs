import { InvoiceError } from './errors.mjs';

// A quantity is a number or a string with up to 3 decimals and above 0. Gives thousandths as a whole number.
export function parseQuantity(value) {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) throw new InvoiceError(`bad quantity ${String(value)}`);
  const milli = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  if (!Number.isSafeInteger(milli) || milli <= 0) throw new InvoiceError(`bad quantity ${String(value)}`);
  return milli;
}
