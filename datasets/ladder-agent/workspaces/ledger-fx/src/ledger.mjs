import { allocate } from './allocate.mjs';
import { convert } from './convert.mjs';
import { feeFor } from './fees.mjs';
import { exponent } from './money.mjs';

// A double-entry ledger over several currencies. Every posting must add up to
// zero in each currency. User accounts are opened with open(); the ledger
// keeps its own accounts `equity:<CUR>`, `fx:<CUR>` and `fees:<CUR>`.
export class Ledger {
  constructor(rates) {
    this.rates = rates;
    this.accounts = new Map();
    this.entries = [];
  }

  open(id, currency) {
    exponent(currency);
    if (this.accounts.has(id)) throw new Error(`account ${id} exists`);
    this.accounts.set(id, { currency, system: false });
    return this;
  }

  #system(prefix, currency) {
    const id = `${prefix}:${currency}`;
    if (!this.accounts.has(id)) this.accounts.set(id, { currency, system: true });
    return id;
  }

  currencyOf(id) {
    const account = this.accounts.get(id);
    if (!account) throw new Error(`no account ${id}`);
    return account.currency;
  }

  post(lines, memo = '') {
    const sums = {};
    for (const line of lines) {
      if (!Number.isInteger(line.amount)) throw new Error('amounts are integers');
      const currency = this.currencyOf(line.account);
      sums[currency] = (sums[currency] ?? 0) + line.amount;
    }
    for (const [currency, sum] of Object.entries(sums)) {
      if (sum !== 0) throw new Error(`posting does not balance in ${currency}`);
    }
    this.entries.push({ memo, lines: lines.map((line) => ({ ...line })) });
  }

  deposit(id, amount) {
    const equity = this.#system('equity', this.currencyOf(id));
    this.post([{ account: id, amount }, { account: equity, amount: -amount }], 'deposit');
  }

  // `amount` is in minor units of the sender's currency. The fee is charged on
  // top, in the sender's currency; the recipient gets the converted amount.
  transfer({ from, to, amount, fee }) {
    const source = this.currencyOf(from);
    const target = this.currencyOf(to);
    const feeMinor = feeFor(amount, fee);
    const lines = [{ account: from, amount: -(amount + feeMinor) }];
    if (feeMinor) lines.push({ account: this.#system('fees', source), amount: feeMinor });
    let received = amount;
    if (source === target) {
      lines.push({ account: to, amount });
    } else {
      received = convert(amount, source, target, this.rates);
      lines.push({ account: this.#system('fx', source), amount });
      lines.push({ account: this.#system('fx', target), amount: -received });
      lines.push({ account: to, amount: received });
    }
    this.post(lines, 'transfer');
    return { fee: feeMinor, received };
  }

  // Pays `amount` (sender's currency) to several accounts in proportion to
  // their weights. Returns the shares in the sender's currency.
  split({ from, amount, payees }) {
    const shares = allocate(amount, payees.map((payee) => payee.weight));
    payees.forEach((payee, index) => {
      if (shares[index] !== 0) this.transfer({ from, to: payee.account, amount: shares[index] });
    });
    return shares;
  }

  balance(id) {
    this.currencyOf(id);
    let total = 0;
    for (const entry of this.entries) for (const line of entry.lines) if (line.account === id) total += line.amount;
    return total;
  }

  // Sum per currency over all accounts, system accounts included. Always zero.
  trialBalance() {
    const sums = {};
    for (const [id, account] of this.accounts) sums[account.currency] = (sums[account.currency] ?? 0) + this.balance(id);
    return sums;
  }

  // What the user accounts are worth together, in minor units of `base`.
  netWorth(base) {
    let total = 0;
    for (const [id, account] of this.accounts) {
      if (account.system) continue;
      total += convert(this.balance(id), account.currency, base, this.rates);
    }
    return total;
  }
}
