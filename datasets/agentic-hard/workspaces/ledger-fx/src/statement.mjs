import { format } from './money.mjs';

// One line per posting that touches the account, with the running balance.
export function statementLines(ledger, id) {
  const currency = ledger.currencyOf(id);
  const lines = [];
  let balance = 0;
  for (const entry of ledger.entries) {
    for (const line of entry.lines) {
      if (line.account !== id) continue;
      balance += line.amount;
      lines.push({ memo: entry.memo, amount: line.amount, balance, currency });
    }
  }
  return lines;
}

export function renderStatement(ledger, id) {
  return statementLines(ledger, id)
    .map((line) => `${line.memo.padEnd(10)} ${format(line.amount, line.currency).padStart(16)} ${format(line.balance, line.currency).padStart(16)}`)
    .join('\n');
}
