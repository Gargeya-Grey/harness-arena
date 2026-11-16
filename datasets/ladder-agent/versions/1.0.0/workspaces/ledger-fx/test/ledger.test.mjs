import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, RateTable, renderStatement } from '../src/index.mjs';

const rates = new RateTable({ 'EUR>USD': '1.0850', 'GBP>USD': '1.2500' });

function books() {
  const ledger = new Ledger(rates);
  ledger.open('alice', 'USD');
  ledger.open('bob', 'USD');
  ledger.open('carol', 'EUR');
  return ledger;
}

test('deposit and balance', () => {
  const ledger = books();
  ledger.deposit('alice', 5000);
  assert.equal(ledger.balance('alice'), 5000);
  assert.deepEqual(ledger.trialBalance(), { USD: 0, EUR: 0 });
});

test('transfer inside one currency with a flat fee', () => {
  const ledger = books();
  ledger.deposit('alice', 5000);
  const result = ledger.transfer({ from: 'alice', to: 'bob', amount: 1000, fee: { flat: 25 } });
  assert.deepEqual(result, { fee: 25, received: 1000 });
  assert.equal(ledger.balance('alice'), 3975);
  assert.equal(ledger.balance('bob'), 1000);
  assert.deepEqual(ledger.trialBalance(), { USD: 0, EUR: 0 });
});

test('transfer across two-digit currencies keeps every currency balanced', () => {
  const ledger = books();
  ledger.deposit('alice', 10000);
  ledger.transfer({ from: 'alice', to: 'carol', amount: 10000 });
  assert.equal(ledger.balance('carol'), 9217);
  assert.deepEqual(ledger.trialBalance(), { USD: 0, EUR: 0 });
});

test('a posting that does not balance is refused', () => {
  const ledger = books();
  assert.throws(() => ledger.post([{ account: 'alice', amount: 5 }]), /does not balance/);
});

test('net worth in one currency', () => {
  const ledger = books();
  ledger.deposit('alice', 2500);
  ledger.deposit('bob', 500);
  assert.equal(ledger.netWorth('USD'), 3000);
});

test('statement shows postings with a running balance', () => {
  const ledger = books();
  ledger.deposit('alice', 5000);
  ledger.transfer({ from: 'alice', to: 'bob', amount: 1200 });
  const lines = renderStatement(ledger, 'alice').split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /50\.00 USD/);
  assert.match(lines[1], /-12\.00 USD/);
  assert.match(lines[1], /38\.00 USD/);
});
