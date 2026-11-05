// One writer at a time on the run store. `node lab run`, `--resume` and `node lab score`
// take this lock, so while an agent call runs, nothing but that call can change the
// stored runs, and the workdir guard can watch all of them with no exceptions. The
// store is the data folder, or the checkout's results/ when there is none. A lock left by
// a process that is gone (a crash, a forced stop) is taken over, by one process only.

import fs from 'node:fs';
import path from 'node:path';
import { processAlive } from './checks.mjs';
import { paths } from './repo.mjs';

export const LOCK_FILE = '.lab-run.lock';
const FRESH_MS = 5000;
const TAKEOVER_STALE_MS = 30000;
// Locks this process holds now: a lock with this pid that is not here is a reused pid.
const held = new Set();

/**
 * The folders whose locks a command takes: every store its guard watches (the data
 * folder and the checkout's results/), so a command of the same checkout that runs with
 * no data folder is refused too.
 */
export function storeFolders(root) {
  const { data } = paths(root);
  return [...new Set([data, path.join(root, 'results')].filter(Boolean))];
}

/** Take every lock in a fixed order (sorted), or none: a refused lock releases the others. */
export function takeLocks(folders, options) {
  const releases = [];
  try {
    for (const folder of [...folders].sort()) releases.push(takeLock(folder, options));
  } catch (error) {
    for (const release of releases.reverse()) release();
    throw error;
  }
  return () => {
    for (const release of releases.reverse()) release();
  };
}

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const age = (file) => {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return Infinity;
  }
};

/**
 * Remove a stale lock, as one process only: a takeover folder is the mutex, and the
 * lock goes only when it still holds the exact bytes that were found stale. Without
 * this, two processes could each delete the other's new lock and both run.
 */
function takeOver(file, staleText) {
  const mutex = `${file}.takeover`;
  if (age(mutex) > TAKEOVER_STALE_MS) fs.rmSync(mutex, { recursive: true, force: true });
  try {
    fs.mkdirSync(mutex);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another lab command is taking over the run store lock. Run again in a moment.');
    throw error;
  }
  try {
    if (readText(file) === staleText) fs.rmSync(file, { force: true });
  } finally {
    fs.rmSync(mutex, { recursive: true, force: true });
  }
}

/**
 * Take the lock of `folder`, or throw when another live process holds it. Returns a
 * release function (also run on process exit). A null folder needs no lock.
 */
export function takeLock(folder, { command, root, log = () => {}, alive = processAlive } = {}) {
  if (!folder) return () => {};
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, LOCK_FILE);
  const text = `${JSON.stringify({ pid: process.pid, command, checkout: root, at: new Date().toISOString() })}\n`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, text, { flag: 'wx' });
      held.add(file);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        held.delete(file);
        process.removeListener('exit', release);
        // Only the lock this call wrote: never one that something else put in its place.
        if (readText(file) === text) fs.rmSync(file, { force: true });
      };
      process.on('exit', release);
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let stat = null;
    try {
      stat = fs.lstatSync(file);
    } catch {
      continue; // Gone meanwhile: try again.
    }
    if (!stat.isFile()) throw new Error(`The run store lock ${file} is not a file. Delete it, then run again.`);
    const found = readText(file);
    const holder = parse(found);
    if (holder?.pid === process.pid && held.has(file)) throw new Error('This process already holds the run store lock.');
    // An unreadable lock may be one another command is still writing: refuse while it is new.
    if (!holder && age(file) < FRESH_MS) throw new Error(`The run store lock ${file} is being written by another lab command. Run again in a moment.`);
    if (holder && holder.pid !== process.pid && alive(holder.pid)) {
      throw new Error(`Another lab command is writing to the run store: "${holder.command}" (process ${holder.pid}, from ${holder.checkout}, since ${holder.at}). One runner at a time keeps the workdir guard exact. Wait for it to finish, or stop it. If process ${holder.pid} is not a lab command (Windows reuses process ids after a forced stop), delete ${file} and run again.`);
    }
    log(`  note: took over a run store lock left by process ${holder?.pid ?? 'unknown'}, which is gone`);
    takeOver(file, found);
  }
  throw new Error(`Could not take the run store lock ${file}. Run again in a moment.`);
}
