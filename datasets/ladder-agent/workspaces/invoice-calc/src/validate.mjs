import { currencyInfo } from './currency.mjs';
import { dayNumber } from './dates.mjs';
import { InvoiceError } from './errors.mjs';
import { parseQuantity } from './quantity.mjs';
import { MODES, requireSafe } from './rounding.mjs';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function amountOf(value, what) {
  requireSafe(value, what);
  if (value < 0) throw new InvoiceError(`${what} is 0 or more`);
  return value;
}

// A discount is { percentBp } (basis points: 1000 is 10%, from 0 to 10000) or { amount } (minor units), not both.
export function normalizeDiscount(discount, what) {
  if (!isObject(discount)) throw new InvoiceError(`${what} is an object`);
  const hasPercent = discount.percentBp !== undefined;
  const hasAmount = discount.amount !== undefined;
  if (hasPercent === hasAmount) throw new InvoiceError(`${what} has percentBp or amount`);
  if (hasPercent) {
    const percentBp = amountOf(discount.percentBp, 'percentBp');
    return { percentBp };
  }
  return { amount: amountOf(discount.amount, 'amount') };
}

function normalizeService(service) {
  if (!isObject(service)) throw new InvoiceError('service is an object');
  const periodStart = dayNumber(service.periodStart);
  const periodEnd = dayNumber(service.periodEnd);
  if (periodEnd < periodStart) throw new InvoiceError('the period ends before it starts');
  const from = service.from === undefined ? undefined : dayNumber(service.from);
  const to = service.to === undefined ? undefined : dayNumber(service.to);
  return { periodStart, periodEnd, from, to };
}

// Gives the invoice input in the form the other modules use, or throws InvoiceError.
export function normalizeInvoice(input) {
  if (!isObject(input)) throw new InvoiceError('an invoice is an object');
  const currency = input.currency;
  currencyInfo(currency);
  const rounding = MODES.includes(input.rounding) ? input.rounding : 'half-up';
  const taxMode = input.taxMode === 'invoice' ? 'invoice' : 'line';
  if (input.pricesIncludeTax !== undefined && typeof input.pricesIncludeTax !== 'boolean') throw new InvoiceError('pricesIncludeTax is true or false');
  if (input.cashRounding !== undefined && typeof input.cashRounding !== 'boolean') throw new InvoiceError('cashRounding is true or false');

  const taxRates = input.taxRates ?? {};
  if (!isObject(taxRates)) throw new InvoiceError('taxRates is an object');
  for (const [name, rate] of Object.entries(taxRates)) {
    amountOf(rate, `the rate of ${name}`);
    if (rate > 10_000) throw new InvoiceError('a tax rate is at most 10000');
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new InvoiceError('an invoice has at least one line');
  const lines = input.lines.map((line, index) => {
    if (!isObject(line)) throw new InvoiceError(`line ${index} is an object`);
    if (typeof line.tax !== 'string' || !Object.hasOwn(taxRates, line.tax)) throw new InvoiceError(`line ${index} has an unknown tax category`);
    if (line.discountable !== undefined && typeof line.discountable !== 'boolean') throw new InvoiceError('discountable is true or false');
    return {
      sku: line.sku ?? null,
      quantityMilli: parseQuantity(line.quantity),
      unitPrice: amountOf(line.unitPrice, 'unitPrice'),
      tax: line.tax,
      rate: taxRates[line.tax],
      discountable: line.discountable ?? true,
      discount: line.discount === undefined ? null : normalizeDiscount(line.discount, 'discount'),
      service: line.service === undefined ? null : normalizeService(line.service),
    };
  });

  let discount = null;
  if (input.discount !== undefined) {
    discount = normalizeDiscount(input.discount, 'discount');
    discount.minSubtotal = input.discount.minSubtotal === undefined ? 0 : amountOf(input.discount.minSubtotal, 'minSubtotal');
    if (input.discount.cap !== undefined) discount.cap = amountOf(input.discount.cap, 'cap');
  }
  return { currency, rounding, taxMode, inclusive: input.pricesIncludeTax === true, cashRounding: input.cashRounding === true, lines, discount };
}
