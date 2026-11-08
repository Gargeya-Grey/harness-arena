import { InvoiceError } from './errors.mjs';
import { parseQuantity } from './quantity.mjs';
import { roundDiv } from './rounding.mjs';

// creditNote(invoice, returns, earlier = []) -> { kind: 'credit', currency, lines, net, tax, total }
// returns: [{ line: index, quantity }], each line once. earlier: credit notes already made for the invoice.
// A returned part of a line is credited in proportion to the net and the tax of that line (after its
// discounts), rounded with the roundingMode of the invoice. When the whole rest of the line is returned, the
// credit is exactly what is left of its net and tax, so that all credits of a line add up to the line. A credit
// is never more than what is left. A quantity above what is left is an InvoiceError, as is an unknown line.
export function creditNote(invoice, returns, earlier = []) {
  if (!Array.isArray(returns) || returns.length === 0) throw new InvoiceError('a credit note returns at least one line');
  const seen = new Set();
  const lines = returns.map(({ line: index, quantity }) => {
    const line = invoice.lines[index];
    if (!Number.isInteger(index) || !line) throw new InvoiceError(`unknown line ${String(index)}`);
    if (seen.has(index)) throw new InvoiceError(`line ${index} is returned twice`);
    seen.add(index);
    const before = earlier.flatMap((note) => note.lines).filter((credit) => credit.line === index);
    const sumOf = (key) => before.reduce((a, credit) => a + credit[key], 0);
    const left = { quantityMilli: line.quantityMilli - sumOf('quantityMilli'), net: line.net - sumOf('net'), tax: line.tax - sumOf('tax') };
    const milli = parseQuantity(quantity);
    if (milli > left.quantityMilli) throw new InvoiceError(`line ${index} has only ${left.quantityMilli} thousandths left`);
    const part = (amount, rest) => (milli === left.quantityMilli ? rest : Math.min(rest, roundDiv(amount * milli, line.quantityMilli, invoice.roundingMode)));
    const net = part(line.net, left.net);
    const tax = part(line.tax, left.tax);
    return { line: index, quantityMilli: milli, net, tax, total: net + tax };
  });
  const net = lines.reduce((a, credit) => a + credit.net, 0);
  const tax = lines.reduce((a, credit) => a + credit.tax, 0);
  return { kind: 'credit', currency: invoice.currency, lines, net, tax, total: net + tax };
}
