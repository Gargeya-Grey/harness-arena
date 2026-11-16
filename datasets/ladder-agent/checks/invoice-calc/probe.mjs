// Hidden probes for ladder-agent-invoice-calc; expected.json holds the answers.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return error.constructor.name;
  }
};
const RATES = { standard: 1900, reduced: 700, zero: 0, uk: 2000 };
const item = (unitPrice, quantity = 1, extra = {}) => ({ unitPrice, quantity, tax: 'zero', ...extra });
const view = (invoice) => ({
  lines: invoice.lines.map((line) => [line.gross, line.discount, line.net, line.tax, line.total]),
  subtotal: invoice.subtotal,
  discount: invoice.discount,
  net: invoice.net,
  tax: invoice.tax,
  total: invoice.total,
  rounding: invoice.rounding,
  due: invoice.due,
  taxes: invoice.taxes,
});
const build = async (load, input) => {
  const { buildInvoice } = await lib(load);
  return attempt(() => view(buildInvoice({ currency: 'EUR', taxRates: RATES, ...input })));
};
const made = async (load, input) => (await lib(load)).buildInvoice({ currency: 'EUR', taxRates: RATES, ...input });
const MIXED = [
  item(1999, 3, { tax: 'standard' }),
  item(1000, '1.5', { tax: 'reduced' }),
  item(500, 1, { tax: 'zero' }),
  item(333, 2, { tax: 'standard' }),
];

export const probes = [
  {
    name: 'zero allocation permits individually safe weights without an unsafe sum',
    run: async ({ load }) => {
      const { allocate } = await load('src/index.mjs');
      const weights = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
      let positive;
      try { allocate(1, weights); positive = 'accepted'; } catch (error) { positive = error.constructor.name; }
      return [allocate(0, weights), positive];
    },
  },
  {
    name: 'keeps a mixed invoice with prices without tax and with tax, line by line',
    run: async ({ load }) => [await build(load, { lines: MIXED }), await build(load, { lines: MIXED, pricesIncludeTax: true }), await build(load, { lines: MIXED.map((line, index) => (index === 0 ? { ...line, discount: { percentBp: 1000 } } : line)) })],
  },
  {
    name: 'a quantity is a number or text with up to three decimals and above zero',
    run: async ({ load }) => {
      const { buildInvoice } = await lib(load);
      const milli = (quantity) => attempt(() => buildInvoice({ currency: 'EUR', taxRates: RATES, lines: [item(1000, quantity)] }).lines[0].quantityMilli);
      return [3, 1.5, '1.5', '0.001', '007', '12.340', 0.1, '1.0005', 0.0004, 1.0001, '1e2', 1e-7, true, null, '', '.5', '5.', 0, -1, '-2', '1,5', ' 1', 0.1 + 0.2, NaN, Infinity, [2]].map(milli);
    },
  },
  {
    name: 'keeps the refusal of bad prices, rates, tax categories, currencies and line lists',
    run: async ({ load }) => [
      await build(load, { lines: [item(10.5)] }),
      await build(load, { lines: [item(-1)] }),
      await build(load, { lines: [item('100')] }),
      await build(load, { lines: [item(NaN)] }),
      await build(load, { lines: [item(100, 1, { tax: 'missing' })] }),
      await build(load, { lines: [item(100, 1, { tax: undefined })] }),
      await build(load, { lines: [] }),
      await build(load, { lines: 'x' }),
      await build(load, { lines: [item(100)], taxRates: { zero: 10001 } }),
      await build(load, { lines: [item(100)], taxRates: { zero: -1 } }),
      await build(load, { lines: [item(100)], taxRates: { zero: 0.5 } }),
      await build(load, { lines: [item(100, 1, { discountable: 'no' })] }),
      await build(load, { currency: 'XXX', lines: [item(100)] }),
      await build(load, { currency: 'eur', lines: [item(100)] }),
      await build(load, { currency: 'constructor', lines: [item(100)] }),
      await build(load, { currency: undefined, lines: [item(100)] }),
      await build(load, { lines: [item(0)] }),
      await build(load, { lines: [item(100, 1, { tax: 'constructor' })] }),
      await build(load, { lines: [item(100, 1, { tax: 'toString' })] }),
      await build(load, { lines: [item(100, 1, { tax: '__proto__' })] }),
    ],
  },
  {
    name: 'a value that does not fit in a safe whole number is refused, a value just below is not',
    run: async ({ load }) => {
      const { buildInvoice, roundDiv, allocate, formatMoney } = await lib(load);
      return [
        await build(load, { lines: [item(9_000_000_000_000, 2000)] }),
        await build(load, { lines: [item(4_000_000_000, 1000)] }),
        await build(load, { lines: [item(1000)], discount: { amount: 2 ** 53 } }),
        await build(load, { lines: [item(2 ** 53)] }),
        attempt(() => roundDiv(2 ** 53, 3)),
        attempt(() => allocate(2 ** 53, [1, 1])),
        attempt(() => formatMoney(2 ** 53, 'USD')),
        attempt(() => buildInvoice({ currency: 'EUR', taxRates: RATES, lines: [item(9_007_199_254_740, 1000)] }).total),
      ];
    },
  },
  {
    name: 'keeps both rounding modes for line amounts and for tax on a line',
    run: async ({ load }) => {
      const lines = [item(250, '0.002'), item(250, '0.006'), item(250, '0.010'), item(250, 1, { tax: 'standard' }), item(150, 1, { tax: 'standard' })];
      return [await build(load, { lines }), await build(load, { lines, rounding: 'half-even' }), await build(load, { lines, rounding: 'half-up' })];
    },
  },
  {
    name: 'an unknown rounding mode, tax mode or flag is refused',
    run: async ({ load }) => [
      await build(load, { lines: [item(100)], rounding: 'up' }),
      await build(load, { lines: [item(100)], rounding: 'HALF-UP' }),
      await build(load, { lines: [item(100)], taxMode: 'group' }),
      await build(load, { lines: [item(100)], pricesIncludeTax: 'yes' }),
      await build(load, { lines: [item(100)], rounding: 'half-even', taxMode: 'invoice', pricesIncludeTax: false }),
    ],
  },
  {
    name: 'the rounding mode of the invoice also applies to a percentage discount on a line and on the invoice',
    run: async ({ load }) => {
      const lines = [item(1005, 1, { discount: { percentBp: 1000 } }), item(995, 1, { discount: { percentBp: 1000 } })];
      return [
        await build(load, { lines, rounding: 'half-even' }),
        await build(load, { lines, rounding: 'half-up' }),
        await build(load, { lines: [item(1005)], discount: { percentBp: 1000 }, rounding: 'half-even' }),
        await build(load, { lines: [item(1005)], discount: { percentBp: 1000 } }),
      ];
    },
  },
  {
    name: 'a discount is a percentBp from 0 to 10000 or an amount, and a fixed discount is never more than the line',
    run: async ({ load }) => [
      await build(load, { lines: [item(3000, 1, { discount: { amount: 5000 } })] }),
      await build(load, { lines: [item(3000, 1, { discount: { percentBp: 10000 } })] }),
      await build(load, { lines: [item(3000, 1, { discount: { percentBp: 10001 } })] }),
      await build(load, { lines: [item(3000, 1, { discount: { percentBp: 1.5 } })] }),
      await build(load, { lines: [item(3000, 1, { discount: { percentBp: -1 } })] }),
      await build(load, { lines: [item(3000, 1, { discount: { percentBp: 100, amount: 100 } })] }),
      await build(load, { lines: [item(3000, 1, { discount: {} })] }),
      await build(load, { lines: [item(3000, 1, { discount: { amount: -1 } })] }),
      await build(load, { lines: [item(3000, 1, { discount: 'half' })] }),
      await build(load, { lines: [item(3000)], discount: { percentBp: 10001 } }),
      await build(load, { lines: [item(3000)], discount: { amount: 100, minSubtotal: -1 } }),
      await build(load, { lines: [item(3000)], discount: { amount: 100, cap: 0.5 } }),
    ],
  },
  {
    name: 'the invoice discount needs a sum of at least minSubtotal, and cap limits a percentage and a fixed amount',
    run: async ({ load }) => {
      const lines = [item(600), item(400)];
      return [
        await build(load, { lines, discount: { percentBp: 1000, minSubtotal: 1000 } }),
        await build(load, { lines, discount: { percentBp: 1000, minSubtotal: 1001 } }),
        await build(load, { lines, discount: { percentBp: 5000, cap: 100 } }),
        await build(load, { lines, discount: { amount: 800, cap: 300 } }),
        await build(load, { lines, discount: { amount: 2000 } }),
        await build(load, { lines, discount: { amount: 2000, cap: 5000 } }),
        await build(load, { lines, discount: { percentBp: 5000, cap: 0 } }),
        await build(load, { lines, discount: { percentBp: 0 } }),
      ];
    },
  },
  {
    name: 'the invoice discount is shared among the lines by largest remainder, equal remainders to the lower index',
    run: async ({ load }) => [
      await build(load, { lines: [item(1000), item(1000), item(1000)], discount: { amount: 100 } }),
      await build(load, { lines: [item(500), item(300), item(200)], discount: { amount: 7 } }),
      await build(load, { lines: [item(1), item(1), item(1), item(1)], discount: { amount: 3 } }),
      await build(load, { lines: [item(7), item(0), item(7)], discount: { amount: 5 } }),
    ],
  },
  {
    name: 'only lines that can be discounted count for the invoice discount and get a share of it',
    run: async ({ load }) => {
      const lines = [item(1000), item(1000, 1, { discountable: false }), item(500)];
      return [
        await build(load, { lines, discount: { percentBp: 1000 } }),
        await build(load, { lines, discount: { percentBp: 1000, minSubtotal: 1600 } }),
        await build(load, { lines, discount: { amount: 5000 } }),
        await build(load, { lines: [item(1000, 1, { discountable: false })], discount: { percentBp: 1000 } }),
        await build(load, { lines: [item(1000, 1, { discountable: false, discount: { percentBp: 2000 } }), item(1000)], discount: { amount: 100 } }),
      ];
    },
  },
  {
    name: 'tax is worked out on the amount left after the line discount and the invoice discount',
    run: async ({ load }) => {
      const lines = [item(1000, 2, { tax: 'standard', discount: { percentBp: 5000 } }), item(1000, 1, { tax: 'reduced' }), item(999, 1, { tax: 'standard', discountable: false })];
      return [
        await build(load, { lines, discount: { percentBp: 1000 } }),
        await build(load, { lines, discount: { percentBp: 1000 }, pricesIncludeTax: true }),
        await build(load, { lines, discount: { amount: 777 }, rounding: 'half-even' }),
        await build(load, { lines, discount: { amount: 777 }, taxMode: 'invoice' }),
      ];
    },
  },
  {
    name: 'prices with tax: net is rounded from the amount and tax is the rest, so ties differ from rounding the tax',
    run: async ({ load }) => [
      await build(load, { lines: [item(3, 1, { tax: 'uk' })], pricesIncludeTax: true }),
      await build(load, { lines: [item(3, 1, { tax: 'uk' })], pricesIncludeTax: true, rounding: 'half-even' }),
      await build(load, { lines: [item(9, 1, { tax: 'uk' })], pricesIncludeTax: true }),
      await build(load, { lines: [item(9, 1, { tax: 'uk' })], pricesIncludeTax: true, rounding: 'half-even' }),
      await build(load, { lines: [item(1000, 1, { tax: 'standard' }), item(5, 1, { tax: 'uk' }), item(15, 1, { tax: 'uk' })], pricesIncludeTax: true }),
    ],
  },
  {
    name: 'taxMode invoice rounds once for each rate and shares the tax among the lines by largest remainder',
    run: async ({ load }) => {
      const lines = [item(333, 1, { tax: 'standard' }), item(333, 1, { tax: 'standard' }), item(333, 1, { tax: 'standard' }), item(250, 1, { tax: 'reduced' }), item(250, 1, { tax: 'reduced' })];
      return [
        await build(load, { lines, taxMode: 'invoice' }),
        await build(load, { lines, taxMode: 'line' }),
        await build(load, { lines, taxMode: 'invoice', pricesIncludeTax: true }),
        await build(load, { lines, taxMode: 'invoice', rounding: 'half-even' }),
        await build(load, { lines: [item(10, 1, { tax: 'zero' }), item(0, 1, { tax: 'standard' })], taxMode: 'invoice' }),
      ];
    },
  },
  {
    name: 'keeps the tax summary: one entry for each rate, categories with the same rate together, lowest rate first',
    run: async ({ load }) => {
      const taxRates = { a: 1900, b: 1900, c: 0, d: 700 };
      const lines = [item(1000, 1, { tax: 'a' }), item(1000, 1, { tax: 'd' }), item(300, 1, { tax: 'b' }), item(50, 1, { tax: 'c' }), item(10, 1, { tax: 'a' })];
      const invoice = await made(load, { taxRates, lines });
      return [invoice.taxes, invoice.lines.map((line) => line.rate), view(await made(load, { taxRates, lines, taxMode: 'invoice' })).taxes];
    },
  },
  {
    name: 'a service line is charged for the days served, both ends included, only inside its period',
    run: async ({ load }) => {
      const june = { periodStart: '2024-06-01', periodEnd: '2024-06-30' };
      const feb = { periodStart: '2024-02-01', periodEnd: '2024-02-29' };
      const one = (service, price = 3000) => build(load, { lines: [item(price, 1, { service })] });
      return [
        await one({ ...june, from: '2024-05-15' }),
        await one({ ...june, to: '2024-07-31' }),
        await one({ ...june, from: '2024-05-15', to: '2024-07-31' }),
        await one({ ...june, from: '2024-07-05' }),
        await one({ ...june, to: '2024-05-20' }),
        await one({ ...june, from: '2024-06-20', to: '2024-06-10' }),
        await one({ ...june, from: '2024-06-30' }),
        await one({ ...june, to: '2024-06-01' }),
        await one({ ...feb, from: '2024-02-16' }, 2900),
        await one({ periodStart: '2024-06-30', periodEnd: '2024-06-30', from: '2024-06-01' }),
      ];
    },
  },
  {
    name: 'keeps a service line over the whole period, from a day, to a day and between two days',
    run: async ({ load }) => {
      const june = { periodStart: '2024-06-01', periodEnd: '2024-06-30' };
      const one = (service, price = 3000, quantity = 1) => build(load, { lines: [item(price, quantity, { service })] });
      return [
        await one(june),
        await one({ ...june, from: '2024-06-11' }),
        await one({ ...june, to: '2024-06-15' }),
        await one({ ...june, from: '2024-06-11', to: '2024-06-20' }),
        await one({ periodStart: '2024-02-01', periodEnd: '2024-02-29', from: '2024-02-16' }, 2900),
        await one({ periodStart: '2024-03-01', periodEnd: '2024-03-07', from: '2024-03-05' }, 1000),
        await one(june, 1000, '2.5'),
        await one({ ...june, from: '2024-06-02' }, 100, 3),
        await build(load, { lines: [item(1000, 1, { service: { ...june, from: '2024-06-02' }, discount: { percentBp: 1000 } })], discount: { amount: 33 } }),
        await build(load, { lines: [item(1000, 1, { service: { ...june, from: '2024-06-02', to: '2024-06-04' } })], rounding: 'half-even' }),
      ];
    },
  },
  {
    name: 'dates are real YYYY-MM-DD dates and a period does not end before it starts',
    run: async ({ load }) => {
      const one = (service) => build(load, { lines: [item(1000, 1, { service })] });
      const june = { periodStart: '2024-06-01', periodEnd: '2024-06-30' };
      return [
        await one({ periodStart: '2023-02-29', periodEnd: '2023-03-31' }),
        await one({ periodStart: '2024-02-30', periodEnd: '2024-03-31' }),
        await one({ periodStart: '2024-04-31', periodEnd: '2024-05-31' }),
        await one({ periodStart: '2024-13-01', periodEnd: '2024-14-01' }),
        await one({ periodStart: '2024-6-1', periodEnd: '2024-06-30' }),
        await one({ periodStart: '2024-06-30', periodEnd: '2024-06-01' }),
        await one({ ...june, from: '2024-06-31' }),
        await one({ ...june, to: 'soon' }),
        await one({ ...june, from: 20240610 }),
        await one({ periodStart: '2024-06-01' }),
        await one('june'),
        await one({ periodStart: '2024-02-29', periodEnd: '2024-02-29' }),
      ];
    },
  },
  {
    name: 'keeps cash rounding in Swiss francs: nearest 5 minor units, a tie up, the difference in rounding',
    run: async ({ load }) => {
      const chf = (price, extra = {}) => made(load, { currency: 'CHF', cashRounding: true, lines: [item(price)], ...extra });
      const out = [];
      for (const price of [1000, 1001, 1002, 1003, 1004, 1005, 0, 5]) {
        const invoice = await chf(price);
        out.push([invoice.total, invoice.rounding, invoice.due]);
      }
      const off = await made(load, { currency: 'CHF', lines: [item(1003)] });
      out.push([off.total, off.rounding, off.due]);
      return out;
    },
  },
  {
    name: 'cash rounding is for Swiss francs only and must be true or false',
    run: async ({ load }) => [
      await build(load, { cashRounding: true, lines: [item(1003)] }),
      await build(load, { currency: 'USD', cashRounding: true, lines: [item(1003)] }),
      await build(load, { currency: 'JPY', cashRounding: true, lines: [item(1003)] }),
      await build(load, { currency: 'CHF', cashRounding: 'yes', lines: [item(1003)] }),
      await build(load, { currency: 'CHF', cashRounding: false, lines: [item(1003)] }),
      await build(load, { currency: 'EUR', cashRounding: false, lines: [item(1003)] }),
    ],
  },
  {
    name: 'credit notes: a part is in proportion to the net and tax after discounts, and the last credit takes what is left',
    run: async ({ load }) => {
      const { creditNote } = await lib(load);
      const invoice = await made(load, { lines: [item(1000, 3, { tax: 'standard' }), item(777, 2, { tax: 'reduced' })], discount: { amount: 100 } });
      const first = creditNote(invoice, [{ line: 0, quantity: 1 }]);
      const second = creditNote(invoice, [{ line: 0, quantity: 1 }, { line: 1, quantity: '0.5' }], [first]);
      const last = creditNote(invoice, [{ line: 0, quantity: 1 }, { line: 1, quantity: '1.5' }], [first, second]);
      const half = creditNote({ ...invoice, roundingMode: 'half-even' }, [{ line: 1, quantity: 1 }]);
      const sum = (key) => [first, second, last].reduce((a, note) => a + note[key], 0);
      return { first, second, last, half, sums: [sum('net'), sum('tax'), sum('total')], invoice: [invoice.net, invoice.tax, invoice.total] };
    },
  },
  {
    name: 'a credit note refuses an unknown line, a line twice, a bad quantity or more than what is left',
    run: async ({ load }) => {
      const { creditNote } = await lib(load);
      const invoice = await made(load, { lines: [item(1000, 3, { tax: 'standard' }), item(500, 1, { tax: 'zero' })] });
      const first = creditNote(invoice, [{ line: 0, quantity: 2 }]);
      return [
        attempt(() => creditNote(invoice, [{ line: 0, quantity: 1 }, { line: 0, quantity: 1 }])),
        attempt(() => creditNote(invoice, [{ line: 2, quantity: 1 }])),
        attempt(() => creditNote(invoice, [{ line: -1, quantity: 1 }])),
        attempt(() => creditNote(invoice, [{ line: 0.5, quantity: 1 }])),
        attempt(() => creditNote(invoice, [{ line: 'length', quantity: 1 }])),
        attempt(() => creditNote(invoice, [{ line: 0, quantity: 0 }])),
        attempt(() => creditNote(invoice, [{ line: 0, quantity: '1.0005' }])),
        attempt(() => creditNote(invoice, [{ line: 0, quantity: 4 }])),
        attempt(() => creditNote(invoice, [{ line: 0, quantity: 2 }], [first])),
        attempt(() => creditNote(invoice, [{ line: 0, quantity: 1 }], [first]).total),
        attempt(() => creditNote(invoice, [])),
        attempt(() => creditNote(invoice, 'all')),
        attempt(() => creditNote(invoice, [{ line: 1, quantity: 1 }]).total),
      ];
    },
  },
  {
    name: 'invoices with a service line, tax per invoice and half-even rounding keep adding up through credit notes',
    run: async ({ load }) => {
      const { creditNote } = await lib(load);
      const invoice = await made(load, {
        rounding: 'half-even',
        taxMode: 'invoice',
        pricesIncludeTax: true,
        lines: [
          item(1990, 3, { tax: 'standard', service: { periodStart: '2024-06-01', periodEnd: '2024-06-30', from: '2024-06-09' } }),
          item(999, '2.5', { tax: 'reduced', discount: { percentBp: 750 } }),
          item(250, 7, { tax: 'uk', discountable: false }),
        ],
        discount: { percentBp: 1234, minSubtotal: 1000, cap: 900 },
      });
      const notes = [];
      for (const returns of [[{ line: 0, quantity: 1 }, { line: 1, quantity: '0.7' }], [{ line: 0, quantity: 1 }, { line: 2, quantity: 3 }], [{ line: 0, quantity: 1 }, { line: 1, quantity: '1.8' }, { line: 2, quantity: 4 }]]) {
        notes.push(creditNote(invoice, returns, notes));
      }
      const sum = (key) => notes.reduce((a, note) => a + note[key], 0);
      return { invoice: view(invoice), notes, sums: [sum('net'), sum('tax'), sum('total')] };
    },
  },
  {
    name: 'formatMoney writes small amounts, zero and negative amounts with the decimals of the currency',
    run: async ({ load }) => {
      const { formatMoney } = await lib(load);
      const f = (minor, currency) => attempt(() => formatMoney(minor, currency));
      return [
        f(5, 'USD'), f(0, 'USD'), f(-0, 'USD'), f(-5, 'USD'), f(99, 'EUR'), f(100, 'EUR'), f(999, 'EUR'), f(1000, 'EUR'),
        f(0, 'JPY'), f(7, 'JPY'), f(-1234, 'JPY'), f(5, 'KWD'), f(0, 'KWD'), f(-45, 'KWD'), f(1234567, 'KWD'),
        f(123456789, 'GBP'), f(-100000000, 'CHF'), f(Number.MAX_SAFE_INTEGER, 'JPY'),
      ];
    },
  },
  {
    name: 'keeps formatMoney for larger amounts and the refusal of bad amounts and currencies',
    run: async ({ load }) => {
      const { formatMoney } = await lib(load);
      const f = (minor, currency) => attempt(() => formatMoney(minor, currency));
      return [f(123450, 'USD'), f(1234, 'JPY'), f(100000000, 'EUR'), f(-123450, 'USD'), f(1.5, 'USD'), f('100', 'USD'), f(NaN, 'USD'), f(100, 'XXX'), f(100, 'usd'), f(100, undefined), f(100, 'toString')];
    },
  },
  {
    name: 'allocate shares a total by largest remainder, equal remainders to the lower index',
    run: async ({ load }) => {
      const { allocate } = await lib(load);
      return [allocate(100, [1, 1, 1]), allocate(7, [500, 300, 200]), allocate(3, [1, 1, 1, 1]), allocate(5, [7, 0, 7]), allocate(2, [1, 1, 1]), allocate(1, [0, 3, 3]), allocate(10, [1]), allocate(99, [33, 33, 33])];
    },
  },
  {
    name: 'keeps allocate for exact splits, zero weights and the refusal of bad input',
    run: async ({ load }) => {
      const { allocate } = await lib(load);
      return [allocate(10, [1, 2, 3]), allocate(0, [0, 0]), allocate(0, []), allocate(12, [1, 1, 1]), attempt(() => allocate(5, [0, 0])), attempt(() => allocate(5, [])), attempt(() => allocate(-1, [1])), attempt(() => allocate(1.5, [1])), attempt(() => allocate(5, [1, -1])), attempt(() => allocate(5, [1, 0.5]))];
    },
  },
  {
    name: 'keeps roundDiv for ties in both modes, also for negative numbers, and the refusal of bad input',
    run: async ({ load }) => {
      const { roundDiv } = await lib(load);
      const r = (n, d, mode) => attempt(() => roundDiv(n, d, mode));
      return [r(7, 2), r(5, 2), r(-5, 2), r(-7, 2), r(5, 2, 'half-even'), r(7, 2, 'half-even'), r(-5, 2, 'half-even'), r(-7, 2, 'half-even'), r(10, 3), r(-10, 3), r(1, 3), r(-1, 3), r(0, 5), r(-1, 2), r(5, 0), r(5, -2), r(1.5, 1), r(1, 1.5), r(5, 2, 'up')];
    },
  },
];
