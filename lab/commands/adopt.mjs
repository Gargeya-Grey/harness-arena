// node lab adopt: the owner vouches for runs as they are now. The evidence ledger trusts
// only runs the lab runner wrote; a run copied in from another clone, committed later,
// or checked by hand after a halt needs the owner's word, recorded as an adopt entry.

import { adoptRuns, ensureLedger, ledgerPath, readLedger, trustRun } from '../lib/ledger.mjs';
import { storeFolders, takeLocks } from '../lib/lock.mjs';
import { findRunDir, runDirs } from '../lib/repo.mjs';

export function adoptCommand(root, refs, { all = false, log = console.log } = {}) {
  if (!refs.length && !all) throw new Error('Name the run ids to adopt, or pass --all for every run the ledger does not trust yet');
  const release = takeLocks(storeFolders(root), { command: 'node lab adopt', root, log });
  try {
    const file = ledgerPath(root);
    ensureLedger(root, { log });
    const ledger = readLedger(file);
    const dirs = runDirs(root);
    let only;
    if (all) {
      only = new Set(dirs.filter(({ name, dir }) => ['untrusted', 'halted'].includes(trustRun(ledger, name, dir).state)).map(({ name }) => name));
    } else {
      for (const ref of refs) if (!findRunDir(root, ref)) throw new Error(`No run ${ref}`);
      only = new Set(refs);
    }
    const adopted = adoptRuns(file, dirs, { only, extra: { by: 'owner' } });
    for (const id of adopted) log(`  adopted ${id}`);
    log(adopted.length ? `${adopted.length} run(s) adopted as they are now.` : 'Nothing to adopt.');
    return adopted;
  } finally {
    release();
  }
}
