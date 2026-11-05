// One writer at a time on the data folder. `node lab run`, `--resume` and `node lab
// score` take this lock, so while an agent call runs, nothing but that call can change
// the stored runs, and the workdir guard can watch all of them with no exceptions. A
// lock left by a process that is gone (a crash) is taken over.

import fs from 'node:fs';
import path from 'node:path';
import { processAlive } from './checks.mjs';

export const LOCK_FILE = '.lab-run.lock';
const FRESH_MS = 5000;
const statTime = (file) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/**
 * Take the lock of `dataDir`, or throw when another live process holds it. Returns a
 * release function (also run on process exit). A null dataDir needs no lock: each
 * checkout's own results/ is watched by that checkout's guard.
 */
export function takeLock(dataDir, { command, root, log = () => {}, alive = processAlive } = {}) {
  if (!dataDir) return () => {};
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, LOCK_FILE);
  const mine = { pid: process.pid, command, checkout: root, at: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, `${JSON.stringify(mine)}\n`, { flag: 'wx' });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        process.removeListener('exit', release);
        try {
          if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === process.pid) fs.rmSync(file, { force: true });
        } catch {
          // Already gone.
        }
      };
      process.on('exit', release);
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      holder = null;
    }
    if (holder?.pid === process.pid) throw new Error('This process already holds the data folder lock.');
    // An unreadable lock may be one another runner is still writing: refuse while it is new.
    if (!holder && Date.now() - statTime(file) < FRESH_MS) {
      throw new Error(`The data folder lock ${LOCK_FILE} is being written by another lab command. Run again in a moment.`);
    }
    if (holder && alive(holder.pid)) {
      throw new Error(`Another lab command is writing to the data folder: "${holder.command}" (process ${holder.pid}, from ${holder.checkout}, since ${holder.at}). One runner at a time keeps the workdir guard exact. Wait for it to finish, or stop it.`);
    }
    log(`  note: took over a data folder lock left by process ${holder?.pid ?? 'unknown'}, which is gone`);
    fs.rmSync(file, { force: true });
  }
  throw new Error(`Could not take the data folder lock ${file}.`);
}
