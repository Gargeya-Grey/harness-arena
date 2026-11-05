import { exponent } from './money.mjs';

function parseDecimal(text) {
  const [whole, fraction = ''] = text.split('.');
  return { num: BigInt(whole + fraction), den: 10n ** BigInt(fraction.length) };
}

// Exchange rates as decimal strings, for example { 'EUR>USD': '1.0850' }.
// rate(from, to) is how many `to` major units one `from` major unit buys.
// A pair may be given in one direction only; the other direction is derived.
// A pair with no table entry in either direction goes through the pivot.
export class RateTable {
  constructor(rates = {}, { pivot = 'USD' } = {}) {
    this.pivot = pivot;
    this.table = new Map();
    for (const [pair, value] of Object.entries(rates)) this.set(pair, value);
  }

  set(pair, value) {
    const [from, to] = pair.split('>');
    exponent(from);
    exponent(to);
    if (!/^\d+(\.\d{1,8})?$/.test(String(value)) || !/[1-9]/.test(String(value))) throw new Error(`bad rate ${value} for ${pair}`);
    this.table.set(`${from}>${to}`, String(value));
    return this;
  }

  has(from, to) {
    return from === to || this.table.has(`${from}>${to}`) || this.table.has(`${to}>${from}`);
  }

  // The exact rate as a fraction of BigInts.
  ratio(from, to) {
    if (from === to) return { num: 1n, den: 1n };
    const direct = this.table.get(`${from}>${to}`);
    if (direct !== undefined) return parseDecimal(direct);
    const inverse = this.table.get(`${to}>${from}`);
    if (inverse !== undefined) {
      const { num, den } = parseDecimal(inverse);
      return { num: den, den: num };
    }
    if (from === this.pivot || to === this.pivot) throw new Error(`no rate for ${from}>${to}`);
    const a = this.ratio(from, this.pivot);
    const b = this.ratio(this.pivot, to);
    return { num: a.num * b.num, den: a.den * b.den };
  }

  rate(from, to) {
    const { num, den } = this.ratio(from, to);
    return Number(num) / Number(den);
  }
}
