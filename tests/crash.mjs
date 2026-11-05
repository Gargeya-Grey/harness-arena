// Test helper: make the evidence ledger look as a real crash leaves it. A runner that
// dies after `kept` rows has written its open entry and one row entry per row, and no
// close or scores entry. Tests that fake a crash by editing a finished run use this, or
// the ledger rightly reads their edit as tampering.

import fs from 'node:fs';
import { ledgerPath } from '../lab/lib/ledger.mjs';

export function crashInLedger(root, runId, kept, { scores = false } = {}) {
  const file = ledgerPath(root);
  let rows = 0;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).filter((line) => {
    const entry = JSON.parse(line);
    if (entry.run_id !== runId) return true;
    if (entry.kind === 'row') return (rows += 1) <= kept;
    return entry.kind === 'open' || (scores && entry.kind === 'scores');
  });
  fs.writeFileSync(file, lines.map((line) => `${line}\n`).join(''));
}
