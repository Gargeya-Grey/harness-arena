import { currencyInfo } from './currency.mjs';
import { requireSafe } from './rounding.mjs';

// formatMoney(minor, currency) -> '1,234.50' for USD, '1,234' for JPY, '1,234.500' for KWD.
// A minus sign in front for a negative amount; a zero never has one. Thousands are grouped with commas.
export function formatMoney(minor, currency) {
  const { decimals } = currencyInfo(currency);
  requireSafe(minor);
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : '';
  return `${minor < 0 ? '-' : ''}${whole}${fraction}`;
}
