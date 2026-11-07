import { InvoiceError } from './errors.mjs';
import { parseQuantity } from './quantity.mjs';
import { roundDiv } from './rounding.mjs';

// creditNote(invoice, returns, earlier = []) -> { kind: 'credit', currency, lines, net, tax, total }
// returns: [{ line: index, quantity }]. earlier: credit notes already made for the invoice.
// A returned part of a line is credited in proportion to the net and the tax of that line (after its
// discounts), rounded with the roundingMode of the invoice. A quantity above what is left is an InvoiceError,
// as is an unknown line.
export function creditNote(invoice, returns, earlier = []) {
  if (!Array.isArray(returns) || returns.length === 0) throw new InvoiceError('a credit note returns at least one line');
  const lines = returns.map(({ line: index, quantity }) => {
    const line = invoice.lines[index];
    if (!Number.isInteger(index) || !line) throw new InvoiceError(`unknown line ${String(index)}`);
    const before = earlier.flatMap((note) => note.lines).filter((credit) => credit.line === index);
    const leftMilli = line.quantityMilli - before.reduce((a, credit) => a + credit.quantityMilli, 0);
    const milli = parseQuantity(quantity);
    if (milli > leftMilli) throw new InvoiceError(`line ${index} has only ${leftMilli} thousandths left`);
    const net = roundDiv(line.net * milli, line.quantityMilli, invoice.roundingMode);
    const tax = roundDiv(line.tax * milli, line.quantityMilli, invoice.roundingMode);
    return { line: index, quantityMilli: milli, net, tax, total: net + tax };
  });
  const net = lines.reduce((a, credit) => a + credit.net, 0);
  const tax = lines.reduce((a, credit) => a + credit.tax, 0);
  return { kind: 'credit', currency: invoice.currency, lines, net, tax, total: net + tax };
}
