import { exponent } from './money.mjs';

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
    if (!/^\d+(\.\d{1,8})?$/.test(String(value))) throw new Error(`bad rate ${value} for ${pair}`);
    this.table.set(`${from}>${to}`, String(value));
    return this;
  }

  has(from, to) {
    return from === to || this.table.has(`${from}>${to}`) || this.table.has(`${to}>${from}`);
  }

  rate(from, to) {
    if (from === to) return 1;
    const direct = this.table.get(`${from}>${to}`);
    if (direct !== undefined) return Number(direct);
    const inverse = this.table.get(`${to}>${from}`);
    if (inverse !== undefined) return 1 / Number(inverse);
    if (from === this.pivot || to === this.pivot) throw new Error(`no rate for ${from}>${to}`);
    return this.rate(from, this.pivot) * this.rate(this.pivot, to);
  }
}
