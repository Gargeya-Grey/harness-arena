// node lab adopt: the owner vouches for runs as they are now. The evidence ledger trusts
// only runs the lab runner wrote; a run copied in from another clone, committed later,
// or checked by hand after a halt needs the owner's word, recorded as an adopt entry.

import { adoptRuns, ensureLedger, ledgerPath, loadLedger, trustRun } from '../lib/ledger.mjs';
import { storeFolders, takeLocks } from '../lib/lock.mjs';
import { findRunDir, runDirs } from '../lib/repo.mjs';

export function adoptCommand(root, refs, { all = false, log = console.log } = {}) {
  if (!refs.length && !all) throw new Error('Name the run ids to adopt, or pass --all for every run the ledger does not trust yet');
  const release = takeLocks(storeFolders(root), { command: 'node lab adopt', root, log });
  try {
    const file = ledgerPath(root);
    ensureLedger(root, { log });
    const ledger = loadLedger(file);
    if (ledger?.unreadable) throw new Error(`Cannot read the evidence ledger ${file} (${ledger.unreadable}); nothing is adopted`);
    const dirs = runDirs(root);
    let only;
    if (all) {
      // A run the guard halted is never adopted in bulk: name it to vouch for it.
      only = new Set(dirs.filter(({ name, dir }) => trustRun(ledger, name, dir).state === 'untrusted').map(({ name }) => name));
    } else {
      for (const ref of refs) {
        const dir = findRunDir(root, ref);
        if (!dir) throw new Error(`No run ${ref}`);
        if (trustRun(ledger, ref, dir).state === 'halted') log(`  note: ${ref} was halted by the workdir guard; adopting it vouches for it as it is now`);
      }
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
