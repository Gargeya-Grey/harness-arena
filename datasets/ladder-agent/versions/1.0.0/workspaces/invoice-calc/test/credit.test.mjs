import test from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceError, buildInvoice, creditNote } from '../src/index.mjs';

const invoice = buildInvoice({
  currency: 'EUR',
  taxRates: { standard: 1900 },
  lines: [{ quantity: 4, unitPrice: 1000, tax: 'standard' }],
});

test('part of a line is credited in proportion', () => {
  const note = creditNote(invoice, [{ line: 0, quantity: 1 }]);
  assert.equal(note.net, 1000);
  assert.equal(note.tax, 190);
  assert.equal(note.total, 1190);
});

test('the last credit takes exactly what is left', () => {
  const first = creditNote(invoice, [{ line: 0, quantity: 3 }]);
  const last = creditNote(invoice, [{ line: 0, quantity: 1 }], [first]);
  assert.equal(first.net + last.net, invoice.net);
  assert.equal(first.tax + last.tax, invoice.tax);
});

test('more than what is left is refused', () => {
  const first = creditNote(invoice, [{ line: 0, quantity: 3 }]);
  assert.throws(() => creditNote(invoice, [{ line: 0, quantity: 2 }], [first]), InvoiceError);
  assert.throws(() => creditNote(invoice, [{ line: 5, quantity: 1 }]), InvoiceError);
});
