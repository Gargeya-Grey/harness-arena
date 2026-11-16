import fs from 'node:fs';
import path from 'node:path';
import { checkouts, isInside, paths } from './repo.mjs';
import { appendEntry, ledgerPath, readLedger } from './ledger.mjs';
import { LOCK_FILE, storeFolders, takeLocks } from './lock.mjs';
import { processAlive } from './checks.mjs';

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,239}$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function runId(value) {
  if (typeof value !== 'string' || !RUN_ID.test(value) || value.endsWith('.') || RESERVED.test(value)) throw new Error('Invalid run ID: use the exact run ID, without a path');
  return value;
}

function statAt(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function plainPath(file) {
  let current = path.resolve(file);
  while (true) {
    const stat = statAt(current);
    if (stat?.isSymbolicLink()) throw new Error(`${current} is a link; history deletion refuses links and junctions`);
    if (stat && !stat.isDirectory() && current !== path.resolve(file)) throw new Error(`${current} is not a plain folder`);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function tree(file) {
  plainPath(file);
  const stat = statAt(file);
  if (!stat) return { path: file, bytes: 0, files: 0, exists: false };
  if (!stat.isDirectory() && (!stat.isFile() || stat.nlink > 1)) throw new Error(`${file} is not a plain file with one link`);
  const identity = { dev: stat.dev, ino: stat.ino, directory: stat.isDirectory() };
  if (!stat.isDirectory()) return { path: file, bytes: stat.size, files: 1, exists: true, identity };
  let size = 0;
  let files = 0;
  for (const name of fs.readdirSync(file)) {
    const child = tree(path.join(file, name));
    size += child.bytes;
    files += child.files;
  }
  return { path: file, bytes: size, files, exists: true, identity };
}

function locations(root) {
  root = path.resolve(root);
  if (root === path.parse(root).root || root.split(path.sep).some((part) => part.toLowerCase() === '.git')) throw new Error(`${root} is not a safe project root`);
  plainPath(root);
  if (!statAt(root)?.isDirectory()) throw new Error(`${root} is not a project folder`);
  if (!statAt(path.join(root, 'datasets'))?.isDirectory() || !statAt(path.join(root, 'prompts'))?.isDirectory() || !statAt(path.join(root, 'configs', 'models.yaml'))?.isFile()) throw new Error(`${root} is not a Model Lab project root; source inputs are required`);
  const p = paths(root);
  const data = path.resolve(p.data ?? root);
  if (p.data && (data === path.parse(data).root || isInside(root, data) || data.split(path.sep).some((part) => part.toLowerCase() === '.git'))) throw new Error(`${data} is not a safe data folder for history deletion`);
  const resultDirs = p.resultsDirs.map((dir) => path.resolve(dir));
  const ledger = path.resolve(ledgerPath(root));
  for (const target of [data, ...resultDirs, ledger]) plainPath(target);
  return { root, data, results: resultDirs, annotations: p.annotations, boards: p.boards, reports: p.reports, ledger };
}

const display = (root, file) => (isInside(file, root) ? path.relative(root, file) || '.' : file).replace(/\\/g, '/');
const shownPath = (root, file) => ({ absolute: file, display: display(root, file) });

function inventory(loc) {
  const runs = new Map();
  const unknown = [];
  const recorded = readLedger(loc.ledger)?.runs;
  for (const base of loc.results) {
    const top = statAt(base);
    if (!top) continue;
    if (!top.isDirectory()) throw new Error(`${base} is not a plain results folder`);
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      const stat = statAt(dir);
      if (name === LOCK_FILE || (name === '.gitkeep' && stat?.isFile() && stat.nlink === 1)) continue;
      if (!stat?.isDirectory() || stat.isSymbolicLink()) {
        unknown.push({ path: dir, reason: 'not a plain run folder' });
        continue;
      }
      let manifest;
      try {
        runId(name);
        const manifestFile = path.join(dir, 'run.json');
        plainPath(manifestFile);
        const manifestStat = statAt(manifestFile);
        if (!manifestStat?.isFile() || manifestStat.nlink > 1) throw new Error('run.json is not a plain file with one link');
        manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        if (manifest?.run_id !== name) throw new Error('run.json does not name its folder');
      } catch (error) {
        // A failed recursive delete can remove run.json before an open artifact fails.
        if (RUN_ID.test(name) && recorded?.get(name)?.deleted) manifest = { run_id: name, status: 'deletion-incomplete' };
        else {
          unknown.push({ path: dir, reason: error.message });
          continue;
        }
      }
      const item = tree(dir);
      const copy = { path: dir, display_path: display(loc.root, dir), bytes: item.bytes, identity: item.identity };
      if (!runs.has(name)) runs.set(name, { run_id: name, path: dir, display_path: copy.display_path, bytes: 0, status: manifest.status ?? null, created_at: manifest.created_at ?? null, finished_at: manifest.finished_at ?? null, deleted: Boolean(recorded?.get(name)?.deleted), paths: [], manifests: [] });
      const run = runs.get(name);
      run.bytes += item.bytes;
      run.paths.push(copy);
      run.manifests.push(manifest);
    }
  }
  return { runs: [...runs.values()].sort((a, b) => a.run_id.localeCompare(b.run_id)), unknown };
}

/** Inventory metadata only; responses and artifacts are never read. */
export function storageSummary(root) {
  const loc = locations(root);
  const { runs, unknown } = inventory(loc);
  return {
    root: loc.root,
    data: loc.data,
    paths: {
      data: shownPath(loc.root, loc.data),
      results: loc.results.map((file) => shownPath(loc.root, file)),
      annotations: shownPath(loc.root, loc.annotations),
      boards: shownPath(loc.root, loc.boards),
      reports: shownPath(loc.root, loc.reports),
      ledger: shownPath(loc.root, loc.ledger),
    },
    run_count: runs.length,
    bytes: runs.reduce((sum, run) => sum + run.bytes, 0),
    runs: runs.map(({ manifests, ...run }) => ({ ...run, paths: run.paths.map(({ identity, ...copy }) => copy) })),
    unknown: unknown.map((item) => ({ ...item, display_path: display(loc.root, item.path) })),
  };
}

function rejectActive(runs) {
  for (const run of runs) {
    if (run.manifests.some((manifest) => manifest.status === 'running' && Number.isInteger(manifest.runner?.pid) && processAlive(manifest.runner.pid))) throw new Error(`Run ${run.run_id} has an active runner; stop it before deleting history`);
  }
}

function removeTarget(target) {
  const now = tree(target.path);
  if (!now.exists) throw new Error(`${target.path} disappeared before deletion; history deletion stopped`);
  if (now.identity.dev !== target.identity.dev || now.identity.ino !== target.identity.ino || now.identity.directory !== target.identity.directory) throw new Error(`${target.path} was replaced before deletion; history deletion stopped`);
  try {
    fs.rmSync(target.path, { recursive: now.identity.directory, force: false });
  } catch (error) {
    let remaining = null;
    try { remaining = tree(target.path).bytes; } catch { /* An unreadable remainder has an unknown byte count. */ }
    error.incomplete = { path: target.path, bytes_deleted: remaining === null ? null : Math.max(0, now.bytes - remaining), remaining_bytes: remaining };
    throw error;
  }
  if (statAt(target.path)) throw new Error(`${target.path} still exists after deletion`);
  return now.bytes;
}

function lockStore(loc, command) {
  const folders = storeFolders(loc.root);
  for (const folder of folders) {
    plainPath(folder);
    const lock = path.join(folder, LOCK_FILE);
    plainPath(lock);
    const stat = statAt(lock);
    if (stat && (!stat.isFile() || stat.nlink > 1)) throw new Error(`${lock} is not a plain lock file with one link`);
    const takeover = `${lock}.takeover`;
    if (statAt(takeover)) throw new Error(`${takeover} exists; history deletion preserves an unknown or active takeover folder`);
  }
  return takeLocks(folders, { root: loc.root, command });
}

function partialFailure(error, removed) {
  if (error.incomplete) {
    removed.incomplete = [error.incomplete];
    removed.bytes_deleted += error.incomplete.bytes_deleted ?? 0;
  }
  error.partial = removed;
}

/** Delete all copies of one exact run ID. A tombstone keeps partial remnants untrusted. */
export function deleteRun(root, id, { confirm } = {}) {
  runId(id);
  if (confirm !== id) throw new Error('Confirm deletion with the exact run ID');
  const loc = locations(root);
  const release = lockStore(loc, `delete-run ${id}`);
  const removed = { run_id: id, bytes_deleted: 0, deleted: [] };
  try {
    const { runs } = inventory(loc);
    const run = runs.find((item) => item.run_id === id);
    if (!run) throw new Error(`Unknown run ID: ${id}`);
    rejectActive([run]);
    appendEntry(loc.ledger, { kind: 'delete', run_id: id }, { realDir: fs.realpathSync.native(path.dirname(loc.ledger)) });
    for (const target of run.paths) {
      removed.bytes_deleted += removeTarget(target);
      removed.deleted.push(target.path);
    }
    return removed;
  } catch (error) {
    partialFailure(error, removed);
    throw error;
  } finally {
    release();
  }
}

/** Reset live evidence/history only; source inputs and reusable fixtures stay intact. */
export function resetHistory(root, { confirm } = {}) {
  if (confirm !== 'DELETE ALL RUNS') throw new Error('Confirm history reset with DELETE ALL RUNS');
  const loc = locations(root);
  const release = lockStore(loc, 'reset-history');
  const removed = { run_count: 0, bytes_deleted: 0, deleted: [] };
  try {
    for (const checkout of checkouts(loc.root)) {
      if (path.relative(loc.root, checkout) === '') continue;
      const resultDir = path.join(checkout, 'results');
      plainPath(resultDir);
      if (statAt(resultDir) && fs.readdirSync(resultDir).some((name) => ![LOCK_FILE, '.gitkeep'].includes(name))) throw new Error(`${checkout} has another checkout's runs sharing this ledger; history reset refused`);
    }
    const { runs, unknown } = inventory(loc);
    if (unknown.length) throw new Error(`Unknown entries in the run store are preserved; history reset refused: ${unknown.map((item) => item.path).join(', ')}`);
    rejectActive(runs);
    const historyPaths = [...new Set([loc.data, loc.root].flatMap((base) => ['annotations', 'boards', 'reports'].map((name) => path.join(base, name))))];
    const history = historyPaths.map(tree).filter((item) => item.exists);
    for (const target of history) if (!target.identity.directory) throw new Error(`${target.path} is not a plain history folder`);
    const ledgerBefore = tree(loc.ledger);
    if (ledgerBefore.exists && ledgerBefore.identity.directory) throw new Error(`${loc.ledger} is not a plain ledger file`);
    for (const run of runs) appendEntry(loc.ledger, { kind: 'delete', run_id: run.run_id }, { realDir: fs.realpathSync.native(path.dirname(loc.ledger)) });
    for (const target of [...runs.flatMap((run) => run.paths), ...history]) {
      removed.bytes_deleted += removeTarget(target);
      removed.deleted.push(target.path);
    }
    const remaining = inventory(loc);
    if (remaining.runs.length || remaining.unknown.length) throw new Error('The run store changed during reset; the ledger was not cleared');
    for (const file of historyPaths) if (statAt(file)) throw new Error(`${file} reappeared during reset; the ledger was not cleared`);
    const ledgerNow = tree(loc.ledger);
    if (ledgerNow.exists && ledgerNow.identity.directory) throw new Error(`${loc.ledger} is not a plain ledger file`);
    // Keep an empty ledger present so a future command never auto-adopts planted runs.
    fs.writeFileSync(loc.ledger, '', { flag: ledgerNow.exists ? 'w' : 'wx' });
    removed.bytes_deleted += ledgerBefore.bytes;
    removed.run_count = runs.length;
    return removed;
  } catch (error) {
    partialFailure(error, removed);
    throw error;
  } finally {
    release();
  }
}
