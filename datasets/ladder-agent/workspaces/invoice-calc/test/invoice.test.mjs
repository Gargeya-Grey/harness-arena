import test from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceError, buildInvoice } from '../src/index.mjs';

const rates = { standard: 1900, reduced: 700, zero: 0 };
const make = (extra = {}, lines = [{ quantity: 2, unitPrice: 1000, tax: 'standard' }]) => buildInvoice({ currency: 'EUR', taxRates: rates, lines, ...extra });

test('prices without tax get tax on top', () => {
  const invoice = make();
  assert.equal(invoice.subtotal, 2000);
  assert.equal(invoice.tax, 380);
  assert.equal(invoice.total, 2380);
  assert.equal(invoice.due, 2380);
});

test('prices with tax are split into net and tax', () => {
  const invoice = make({ pricesIncludeTax: true }, [{ quantity: 1, unitPrice: 1190, tax: 'standard' }]);
  assert.equal(invoice.net, 1000);
  assert.equal(invoice.tax, 190);
  assert.equal(invoice.total, 1190);
});

test('a quantity may have up to three decimals', () => {
  const invoice = make({}, [{ quantity: '1.5', unitPrice: 1000, tax: 'zero' }]);
  assert.equal(invoice.subtotal, 1500);
  assert.throws(() => make({}, [{ quantity: '1.0005', unitPrice: 1000, tax: 'zero' }]), InvoiceError);
});

test('a percentage discount on a line is taken before tax', () => {
  const invoice = make({}, [{ quantity: 2, unitPrice: 1000, tax: 'standard', discount: { percentBp: 1000 } }]);
  assert.equal(invoice.discount, 200);
  assert.equal(invoice.net, 1800);
  assert.equal(invoice.tax, 342);
});

test('an invoice discount goes only to lines that can be discounted', () => {
  const invoice = make({ discount: { amount: 100 } }, [
    { quantity: 1, unitPrice: 1000, tax: 'zero' },
    { quantity: 1, unitPrice: 1000, tax: 'zero', discountable: false },
  ]);
  assert.deepEqual(invoice.lines.map((line) => line.discount), [100, 0]);
  assert.equal(invoice.total, 1900);
});

test('a service line is charged for the days it was served', () => {
  const service = { periodStart: '2024-06-01', periodEnd: '2024-06-30', from: '2024-06-11' };
  const invoice = make({}, [{ quantity: 1, unitPrice: 3000, tax: 'zero', service }]);
  assert.equal(invoice.subtotal, 2000);
});

test('cash rounding gives the amount due in Swiss francs', () => {
  const invoice = buildInvoice({ currency: 'CHF', taxRates: { zero: 0 }, cashRounding: true, lines: [{ quantity: 1, unitPrice: 1003, tax: 'zero' }] });
  assert.equal(invoice.total, 1003);
  assert.equal(invoice.due, 1005);
  assert.equal(invoice.rounding, 2);
});

test('the tax summary has one entry per rate', () => {
  const invoice = make({}, [
    { quantity: 1, unitPrice: 1000, tax: 'standard' },
    { quantity: 1, unitPrice: 1000, tax: 'reduced' },
    { quantity: 1, unitPrice: 500, tax: 'standard' },
  ]);
  assert.deepEqual(invoice.taxes, [
    { rate: 700, taxable: 1000, tax: 70 },
    { rate: 1900, taxable: 1500, tax: 285 },
  ]);
});
