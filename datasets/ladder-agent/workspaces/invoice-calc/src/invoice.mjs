import { invoiceDiscount, lineDiscount } from './discounts.mjs';
import { lineGross } from './proration.mjs';
import { splitTax, taxSummary } from './tax.mjs';
import { invoiceTotals } from './totals.mjs';
import { normalizeInvoice } from './validate.mjs';

// buildInvoice(input) -> { currency, roundingMode, lines, taxes, subtotal, discount, net, tax, total, due, ... }
// Order of work: the gross of every line; the discount of every line; the invoice discount on what is left of
// the lines; tax on what is left of every line. Each line gives
// { sku, quantityMilli, rate, gross, discount, net, tax, total } where discount is the line discount and
// the share of the invoice discount together.
export function buildInvoice(input) {
  const config = normalizeInvoice(input);
  const { rounding } = config;
  const grosses = config.lines.map((line) => lineGross(line, rounding));
  const ownDiscounts = config.lines.map((line, index) => lineDiscount(line.discount, grosses[index]));
  const left = grosses.map((gross, index) => gross - ownDiscounts[index]);
  const shared = invoiceDiscount(config.discount, left, config.lines.map((line) => line.discountable), rounding);
  const split = splitTax(left, config.lines.map((line) => line.rate), { inclusive: config.inclusive, rounding });

  const lines = config.lines.map((line, index) => ({
    sku: line.sku,
    quantityMilli: line.quantityMilli,
    rate: line.rate,
    gross: grosses[index],
    discount: ownDiscounts[index] + shared.shares[index],
    net: split[index].net - shared.shares[index],
    tax: split[index].tax,
    total: split[index].net - shared.shares[index] + split[index].tax,
  }));
  return { currency: config.currency, roundingMode: rounding, lines, taxes: taxSummary(lines), ...invoiceTotals(lines, config) };
}
