import { InvoiceError } from './errors.mjs';

// A quantity is a number or a string with up to 3 decimals and above 0. Gives thousandths as a whole number.
export function parseQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new InvoiceError(`bad quantity ${String(value)}`);
  return Math.round(number * 1000);
}
