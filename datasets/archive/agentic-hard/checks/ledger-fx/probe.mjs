// Hidden probes for agentic-hard-ledger-fx; expected.json holds the answers.
// Every probe goes through the public exports of src/index.mjs.
const lib = (load) => load('src/index.mjs');
const table = async (load, pairs) => {
  const { RateTable } = await lib(load);
  return new RateTable(pairs);
};
const threw = (fn) => {
  try {
    fn();
    return 'returned';
  } catch {
    return 'threw';
  }
};
const MAIN = { 'EUR>USD': '1.0850', 'USD>JPY': '150.25', 'USD>KWD': '0.3075', 'EUR>JPY': '161.5' };

export const probes = [
  {
    name: 'keeps toMinor and format for positive amounts',
    run: async ({ load }) => {
      const { toMinor, format } = await lib(load);
      return [toMinor('12.34', 'USD'), toMinor('5', 'JPY'), toMinor('1.5', 'KWD'), format(123456, 'USD'), format(5000, 'JPY'), format(1500, 'KWD'), format(0, 'EUR'), threw(() => toMinor('10.5', 'JPY')), threw(() => toMinor('1.2345', 'KWD')), threw(() => toMinor('abc', 'USD'))];
    },
  },
  {
    name: 'format keeps the sign of amounts under one major unit',
    run: async ({ load }) => {
      const { format } = await lib(load);
      return [format(-5, 'USD'), format(-5, 'KWD'), format(-99, 'EUR'), format(-1234567, 'USD'), format(-100, 'USD'), format(-250, 'JPY')];
    },
  },
  {
    name: 'convert uses the exponent of each currency for yen',
    run: async ({ load }) => {
      const { convert } = await lib(load);
      const rates = await table(load, MAIN);
      return [convert(1000, 'USD', 'JPY', rates), convert(25, 'USD', 'JPY', rates), convert(1503, 'JPY', 'USD', rates), convert(1, 'JPY', 'USD', rates)];
    },
  },
  {
    name: 'convert uses the exponent of each currency for three-digit currencies',
    run: async ({ load }) => {
      const { convert } = await lib(load);
      const rates = await table(load, MAIN);
      return [convert(10000, 'USD', 'KWD', rates), convert(30750, 'KWD', 'USD', rates), convert(1000, 'JPY', 'KWD', rates)];
    },
  },
  {
    name: 'convert rounds halves away from zero',
    run: async ({ load }) => {
      const { convert } = await lib(load);
      const rates = await table(load, { 'USD>EUR': '0.5' });
      return [convert(5, 'USD', 'EUR', rates), convert(-5, 'USD', 'EUR', rates), convert(-3, 'USD', 'EUR', rates), convert(1, 'USD', 'EUR', rates), convert(-1, 'USD', 'EUR', rates), convert(0, 'USD', 'EUR', rates)];
    },
  },
  {
    name: 'convert does not lose exact halves to binary floating point',
    run: async ({ load }) => {
      const { convert } = await lib(load);
      const a = await table(load, { 'USD>EUR': '0.145' });
      const b = await table(load, { 'USD>EUR': '1.005' });
      return [convert(100, 'USD', 'EUR', a), convert(1000, 'USD', 'EUR', b), convert(10, 'USD', 'EUR', b)];
    },
  },
  {
    name: 'a derived inverse rate is exact',
    run: async ({ load }) => {
      const { convert } = await lib(load);
      const rates = await table(load, { 'USD>JPY': '150.25', 'USD>EUR': '0.00000123' });
      return [convert(15025, 'JPY', 'USD', rates), convert(3005, 'JPY', 'USD', rates), convert(123, 'EUR', 'USD', rates), convert(100000000, 'USD', 'EUR', rates)];
    },
  },
  {
    name: 'a conversion through the pivot rounds once',
    run: async ({ load }) => {
      const { convert } = await lib(load);
      const rates = await table(load, { 'EUR>USD': '1.0850', 'USD>GBP': '0.7900', 'USD>JPY': '150.25' });
      return [convert(102, 'EUR', 'GBP', rates), convert(116, 'EUR', 'GBP', rates), convert(333, 'EUR', 'JPY', rates), convert(87, 'GBP', 'EUR', rates)];
    },
  },
  {
    name: 'keeps rate() as a plain number',
    run: async ({ load }) => {
      const rates = await table(load, MAIN);
      return [rates.rate('EUR', 'USD'), rates.rate('EUR', 'EUR'), typeof rates.rate('USD', 'EUR'), rates.rate('USD', 'JPY')];
    },
  },
  {
    name: 'keeps a missing rate an error',
    run: async ({ load }) => {
      const { convert } = await lib(load);
      const rates = await table(load, { 'EUR>USD': '1.0850' });
      return [threw(() => convert(100, 'EUR', 'GBP', rates)), threw(() => convert(100, 'EUR', 'XXX', rates)), convert(100, 'EUR', 'EUR', rates)];
    },
  },
  {
    name: 'the percentage fee rounds half away from zero',
    run: async ({ load }) => {
      const { feeFor } = await lib(load);
      return [feeFor(100, { bps: 50 }), feeFor(1050, { bps: 50 }), feeFor(1100, { bps: 50 }), feeFor(30, { bps: 50 }), feeFor(1, { bps: 5000, flat: 7 })];
    },
  },
  {
    name: 'keeps flat and percentage fees adding up',
    run: async ({ load }) => {
      const { feeFor } = await lib(load);
      return [feeFor(10000, { bps: 25, flat: 30 }), feeFor(5000, { flat: 10 }), feeFor(5000), feeFor(0, { bps: 100 })];
    },
  },
  {
    name: 'a transfer into yen with a fee',
    run: async ({ load }) => {
      const { Ledger } = await lib(load);
      const ledger = new Ledger(await table(load, MAIN));
      ledger.open('alice', 'USD');
      ledger.open('jun', 'JPY');
      ledger.deposit('alice', 100000);
      const result = ledger.transfer({ from: 'alice', to: 'jun', amount: 20000, fee: { bps: 50, flat: 100 } });
      return { result, alice: ledger.balance('alice'), jun: ledger.balance('jun'), trial: ledger.trialBalance() };
    },
  },
  {
    name: 'a transfer into a three-digit currency',
    run: async ({ load }) => {
      const { Ledger } = await lib(load);
      const ledger = new Ledger(await table(load, MAIN));
      ledger.open('alice', 'USD');
      ledger.open('khalid', 'KWD');
      ledger.open('jun', 'JPY');
      ledger.deposit('alice', 9000);
      ledger.deposit('jun', 5000);
      ledger.transfer({ from: 'alice', to: 'khalid', amount: 5000 });
      const back = ledger.transfer({ from: 'jun', to: 'khalid', amount: 1000 });
      return { khalid: ledger.balance('khalid'), back, trial: ledger.trialBalance() };
    },
  },
  {
    name: 'split gives away every unit',
    run: async ({ load }) => {
      const { Ledger } = await lib(load);
      const ledger = new Ledger(await table(load, MAIN));
      for (const id of ['payer', 'p1', 'p2', 'p3']) ledger.open(id, 'USD');
      ledger.deposit('payer', 1000);
      const shares = ledger.split({ from: 'payer', amount: 100, payees: [{ account: 'p1', weight: 1 }, { account: 'p2', weight: 1 }, { account: 'p3', weight: 1 }] });
      return { shares, balances: ['payer', 'p1', 'p2', 'p3'].map((id) => ledger.balance(id)) };
    },
  },
  {
    name: 'split to payees in other currencies',
    run: async ({ load }) => {
      const { Ledger } = await lib(load);
      const ledger = new Ledger(await table(load, MAIN));
      ledger.open('payer', 'USD');
      ledger.open('e', 'EUR');
      ledger.open('j', 'JPY');
      ledger.open('u', 'USD');
      ledger.deposit('payer', 5000);
      const shares = ledger.split({ from: 'payer', amount: 1000, payees: [{ account: 'e', weight: 1 }, { account: 'j', weight: 2 }, { account: 'u', weight: 3 }] });
      return { shares, e: ledger.balance('e'), j: ledger.balance('j'), u: ledger.balance('u'), payer: ledger.balance('payer'), trial: ledger.trialBalance() };
    },
  },
  {
    name: 'allocate hands leftover units to the largest remainders',
    run: async ({ load }) => {
      const { allocate } = await lib(load);
      return [allocate(100, [1, 1, 1]), allocate(7, [1, 1]), allocate(10, [1, 3, 3]), allocate(1000, [1, 2, 3]), allocate(2, [1, 1, 1, 1]), allocate(1, [1, 1, 1])];
    },
  },
  {
    name: 'allocate with zero weights, zero totals and negative totals',
    run: async ({ load }) => {
      const { allocate } = await lib(load);
      return [allocate(5, [0, 0, 5]), allocate(0, [1, 2]), allocate(-100, [1, 1, 1]), allocate(10, [3]), allocate(5, [0, 1, 0]), allocate(-1, [1, 1])];
    },
  },
  {
    name: 'allocate refuses weights that cannot be used',
    run: async ({ load }) => {
      const { allocate } = await lib(load);
      return [threw(() => allocate(10, [0, 0])), threw(() => allocate(10, [-1, 2])), threw(() => allocate(10, []))];
    },
  },
  {
    name: 'keeps allocate on weights that divide evenly',
    run: async ({ load }) => {
      const { allocate } = await lib(load);
      return [allocate(100, [1, 1]), allocate(90, [1, 2]), allocate(100, [25, 75]), allocate(0, [1])];
    },
  },
  {
    name: 'net worth converts each currency total once',
    run: async ({ load }) => {
      const { Ledger } = await lib(load);
      const ledger = new Ledger(await table(load, MAIN));
      for (let i = 0; i < 10; i += 1) {
        ledger.open(`e${i}`, 'EUR');
        ledger.deposit(`e${i}`, 5);
      }
      ledger.open('u', 'USD');
      ledger.deposit('u', 1000);
      return [ledger.netWorth('JPY'), ledger.netWorth('EUR'), ledger.netWorth('USD')];
    },
  },
  {
    name: 'keeps net worth free of the ledger accounts',
    run: async ({ load }) => {
      const { Ledger } = await lib(load);
      const ledger = new Ledger(await table(load, MAIN));
      ledger.open('a', 'USD');
      ledger.open('b', 'USD');
      ledger.deposit('a', 5000);
      ledger.transfer({ from: 'a', to: 'b', amount: 1000, fee: { flat: 25 } });
      return [ledger.netWorth('USD'), ledger.balance('a'), ledger.balance('b')];
    },
  },
  {
    name: 'a statement keeps the sign of small negative amounts',
    run: async ({ load }) => {
      const { Ledger, renderStatement } = await lib(load);
      const ledger = new Ledger(await table(load, MAIN));
      ledger.open('a', 'USD');
      ledger.open('b', 'USD');
      ledger.deposit('a', 5000);
      ledger.transfer({ from: 'a', to: 'b', amount: 5 });
      return renderStatement(ledger, 'a').split('\n').map((line) => line.trim().split(/\s+/));
    },
  },
  {
    name: 'keeps the trial balance at zero after mixed postings',
    run: async ({ load }) => {
      const { Ledger } = await lib(load);
      const ledger = new Ledger(await table(load, MAIN));
      ledger.open('a', 'USD');
      ledger.open('b', 'EUR');
      ledger.open('c', 'JPY');
      ledger.open('d', 'KWD');
      ledger.deposit('a', 100000);
      ledger.deposit('b', 50000);
      ledger.transfer({ from: 'a', to: 'c', amount: 12345, fee: { bps: 30, flat: 50 } });
      ledger.transfer({ from: 'b', to: 'd', amount: 777 });
      ledger.transfer({ from: 'c', to: 'a', amount: 100 });
      ledger.split({ from: 'a', amount: 999, payees: [{ account: 'b', weight: 1 }, { account: 'd', weight: 1 }] });
      return ledger.trialBalance();
    },
  },
  {
    name: 'keeps the public exports',
    run: async ({ load }) => {
      const names = Object.keys(await lib(load));
      return ['CURRENCIES', 'exponent', 'format', 'toMinor', 'RateTable', 'convert', 'feeFor', 'allocate', 'Ledger', 'renderStatement', 'statementLines'].filter((name) => !names.includes(name));
    },
  },
];
