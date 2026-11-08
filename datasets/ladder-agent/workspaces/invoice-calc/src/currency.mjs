import { InvoiceError } from './errors.mjs';

// Amounts are whole numbers of the smallest unit ("minor units"): cents for USD, yen for JPY, fils for KWD.
// cashStep is the step of cash rounding in minor units.
const CURRENCIES = {
  USD: { decimals: 2 },
  EUR: { decimals: 2 },
  GBP: { decimals: 2 },
  JPY: { decimals: 0 },
  KWD: { decimals: 3 },
  CHF: { decimals: 2, cashStep: 5 },
};

export function currencyInfo(code) {
  if (typeof code !== 'string' || !Object.hasOwn(CURRENCIES, code)) throw new InvoiceError(`unknown currency ${String(code)}`);
  return CURRENCIES[code];
}
