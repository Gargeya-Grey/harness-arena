import { InvoiceError } from './errors.mjs';

// 'YYYY-MM-DD' -> number of days since 1970-01-01. Throws InvoiceError for text that is not a real date.
export function dayNumber(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text));
  if (!match) throw new InvoiceError(`bad date ${String(text)}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31 || Number.isNaN(date.getTime())) {
    throw new InvoiceError(`${text} is not a date`);
  }
  return ms / 86_400_000;
}
