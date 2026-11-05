// The evidence ledger: a record, outside the run store, of what each run wrote. The
// workdir guard can only notice a change while it watches; a ledger makes a forged or
// edited run show later, whenever it is read, however the change was made.
//
// The ledger is lab.ledger.jsonl at the main checkout (every worktree shares it), not in
// the data folder: a forgery must then change two places, and the guard watches both
// during every agent call. It is compact JSONL, one entry per line, and only grows:
//   open    a run started; `core` is the sha256 of run.json without its changing fields
//   resume  a resume reopened a run, before it wrote anything: the rows it keeps and its files
//   row     one row was written: the sha256 of its line, and of every file the call wrote
//   halt    the guard stopped the run (written before the run closes)
//   close   the run closed: the sha256 of every file but scores/, and of every row line
//   adopt   a run vouched for as it is: when the ledger is created, or by `node lab adopt`
//   scores  the scores/ files written for a run (sha256 each)
// A closed run is trusted when its files match its last close or adopt entry. A run still
// open (or crashed) is trusted as far as it goes: its run.json core, every recorded file
// and every recorded row must match. A run with a halt entry is halted, whatever run.json
// says. Scores are derived data: when they do not match their last scores entry they do
// not count, and a re-score repairs them. No ledger file at all: every run reads as before.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './fsutil.mjs';
import { listDirs } from './fsutil.mjs';
import { mainCheckout, runDirs } from './repo.mjs';
import { listTree } from './workspace.mjs';

export const LEDGER_FILE = 'lab.ledger.jsonl';
export const LEDGER_SCHEMA = 'ledger.schema.json';
// Run files the runner keeps writing while a run is open; the ledger checks them at close.
const OPEN_VOLATILE = new Set(['run.json', 'raw.jsonl', 'harness-events.ndjson']);

export function ledgerPath(root) {
  return path.join(mainCheckout(root) ?? root, LEDGER_FILE);
}

/** The exact line appendJsonl writes for a record, so the ledger can hash a row. */
export const rowLine = (record) => `${JSON.stringify(record)}\n`;
export const lineSha = (line) => sha256(line.endsWith('\n') ? line : `${line}\n`);

/** sha256 of run.json without the fields a heartbeat, a close or a resume changes. */
export function manifestCore(manifest) {
  const rest = { ...(manifest || {}) };
  for (const key of ['status', 'finished_at', 'runner', 'notes']) delete rest[key];
  if (rest.harness) {
    const settings = { ...(rest.harness.settings || {}) };
    for (const key of ['halted', 'version_end', 'workdir_git_fence']) delete settings[key];
    rest.harness = { ...rest.harness, settings };
  }
  return sha256(JSON.stringify(rest));
}

function checkFile(file, realDir) {
  const dir = path.dirname(file);
  if (realDir && fs.realpathSync.native(dir) !== realDir) throw new Error(`the ledger folder ${dir} is not the folder the run started with`);
  let stat = null;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (stat && (!stat.isFile() || stat.nlink > 1)) throw new Error(`the ledger ${file} is not a plain file with one link`);
  return stat;
}

const entryText = (entry) => `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;

/**
 * Append one entry. The ledger must be a plain file with one link (or not exist yet), in
 * the folder the run started with: an entry is never written through a link or into a
 * redirected folder. A refused write throws; the run then has no close entry and reads
 * as not trusted (the ledger fails closed).
 */
export function appendEntry(file, entry, { realDir = null } = {}) {
  const stat = checkFile(file, realDir);
  // A torn last line (a crash during an append) must not swallow this entry.
  let lead = '';
  if (stat?.size) {
    const fd = fs.openSync(file, 'r');
    try {
      const last = Buffer.alloc(1);
      fs.readSync(fd, last, 0, 1, stat.size - 1);
      if (last[0] !== 0x0a) lead = '\n';
    } finally {
      fs.closeSync(fd);
    }
  }
  fs.appendFileSync(file, `${lead}${entryText(entry)}`, 'utf8');
}

/** The ledger's bytes now (null when there is none), to restore after a halted call. */
export function ledgerBytes(file) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * After a halted agent call: put the ledger back to the bytes it held before the call,
 * plus the halt entry, through a new file (never through a link). Whatever the agent
 * wrote to the ledger is dropped, and kept aside for the owner to read. Returns the
 * aside file, or null when the ledger had not changed.
 */
export function restoreLedger(file, before, entry, { realDir = null, asideName } = {}) {
  const dir = path.dirname(file);
  if (realDir && fs.realpathSync.native(dir) !== realDir) throw new Error(`the ledger folder ${dir} is not the folder the run started with`);
  let now = null;
  try {
    now = fs.readFileSync(file);
  } catch {
    now = null;
  }
  const prefix = before ?? Buffer.alloc(0);
  let aside = null;
  if (now && !now.equals(prefix)) {
    aside = path.join(dir, asideName);
    fs.writeFileSync(aside, now, { flag: 'wx' });
  }
  const text = Buffer.concat([prefix, Buffer.from(`${prefix.length && prefix[prefix.length - 1] !== 0x0a ? '\n' : ''}${entryText(entry)}`, 'utf8')]);
  const temp = path.join(dir, `.${LEDGER_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temp, text, { flag: 'wx' });
  fs.renameSync(temp, file);
  return aside;
}

/**
 * Every run in the ledger: Map run_id -> { files, lines, closed, halted, scores, core }.
 * Null when there is no ledger. Lines that do not parse are returned as problems.
 */
export function readLedger(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const runs = new Map();
  const problems = [];
  const entries = [];
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      problems.push({ line: index + 1, message: `invalid JSON: ${error.message}` });
      return;
    }
    entries.push({ line: index + 1, entry });
    const id = entry?.run_id;
    if (typeof id !== 'string') {
      problems.push({ line: index + 1, message: 'entry has no run_id' });
      return;
    }
    if (!runs.has(id)) runs.set(id, { files: {}, lines: [], closed: false, halted: null, scores: null, core: null });
    const run = runs.get(id);
    switch (entry.kind) {
      case 'open':
        Object.assign(run, { files: {}, lines: [], closed: false, core: entry.core ?? null });
        break;
      case 'resume':
        Object.assign(run, { files: { ...(entry.files || {}) }, lines: [...(entry.lines || [])], closed: false, core: entry.core ?? null });
        break;
      case 'row':
        run.lines.push(entry.sha256);
        Object.assign(run.files, entry.files || {});
        run.closed = false;
        break;
      case 'halt':
        run.halted = entry.reason || 'left_workdir';
        break;
      case 'close':
      case 'adopt':
        Object.assign(run, { files: { ...(entry.files || {}) }, lines: [...(entry.lines || [])], closed: true, core: null });
        if (entry.halted) run.halted = run.halted || entry.halted;
        // An owner's adopt vouches for the run as it is now, halted or not.
        if (entry.kind === 'adopt') run.halted = entry.halted || null;
        break;
      case 'scores':
        run.scores = entry.files || {};
        break;
      default:
        problems.push({ line: index + 1, message: `unknown entry kind ${JSON.stringify(entry.kind)}` });
    }
  });
  return { runs, problems, entries };
}

// Hashing every stored file on every dashboard request is slow on a big store. A file
// keeps its hash while its size, times and file id stay the same; one entry per path.
const hashCache = new Map();
function fileSha(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) return 'not a file';
  const key = `${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}|${stat.ino}`;
  const cached = hashCache.get(file);
  if (cached?.key === key) return cached.sha;
  const sha = sha256(fs.readFileSync(file));
  hashCache.set(file, { key, sha });
  return sha;
}

/** sha256 of every entry of a run folder, split into evidence files and scores/ files. */
export function runFiles(runDir) {
  const others = [];
  const files = {};
  const scores = {};
  for (const rel of listTree(runDir, new Set(), others)) {
    const sha = fileSha(path.join(runDir, ...rel.split('/')));
    if (rel.startsWith('scores/')) scores[rel] = sha;
    else files[rel] = sha;
  }
  for (const rel of others) files[rel] = 'not a file';
  return { files, scores };
}

/** The files a call writes and a row entry records: everything but the files that change while a run is open. */
export function callFiles(runDir) {
  const { files } = runFiles(runDir);
  for (const rel of OPEN_VOLATILE) delete files[rel];
  return files;
}

/** sha256 of each line of raw.jsonl, in order. */
export function rowLines(runDir) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(runDir, 'raw.jsonl'), 'utf8');
  } catch {
    return { lines: [], torn: false };
  }
  // A last line with no newline counts too: a recorded row must match it, and a torn one
  // has no entry, so it shows as the one unrecorded last row a crash may leave.
  const parts = text.split('\n');
  const torn = parts.at(-1) !== '';
  const whole = torn ? parts : parts.slice(0, -1);
  return { lines: whole.map((line) => lineSha(line)), torn };
}

const firstDiff = (want, have, { extraOk = false } = {}) => {
  for (const key of Object.keys(want)) if (have[key] !== want[key]) return key in have ? `${key} changed` : `${key} is missing`;
  if (!extraOk) for (const key of Object.keys(have)) if (!(key in want)) return `${key} was added`;
  return null;
};

/**
 * How far a run can be trusted, from the ledger. `state`:
 *   legacy     no ledger in use
 *   trusted    closed, and its files match its last close or adopt entry
 *   open       still being written (or crashed): run.json core, recorded files and rows match
 *   halted     the ledger says the guard stopped it
 *   untrusted  not in the ledger, in a folder not named after it, or a file does not match
 * `scores`: match (they count) or mismatch (they do not count; a re-score repairs them).
 */
export function trustRun(ledger, runId, runDir) {
  if (!ledger) return { state: 'legacy', scores: 'match' };
  if (path.basename(runDir) !== runId) return { state: 'untrusted', scores: 'mismatch', reason: `its folder ${path.basename(runDir)} is not named after its run_id` };
  const run = ledger.runs.get(runId);
  if (!run) return { state: 'untrusted', scores: 'mismatch', reason: 'it is not in the ledger: it was not written by the lab runner, or was copied in (node lab adopt vouches for it)' };
  const { files, scores } = runFiles(runDir);
  const scoreDiff = firstDiff(run.scores || {}, scores);
  const scoreState = scoreDiff ? { scores: 'mismatch', scores_reason: `${scoreDiff} since the scores were recorded` } : { scores: 'match' };
  if (run.halted) return { state: 'halted', reason: run.halted, ...scoreState };
  if (run.closed) {
    const changed = firstDiff(run.files, files);
    if (changed) return { state: 'untrusted', scores: 'mismatch', reason: `${changed} since the run closed` };
    return { state: 'trusted', ...scoreState };
  }
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  } catch {
    manifest = null;
  }
  if (run.core && (!manifest || manifestCore(manifest) !== run.core)) return { state: 'untrusted', scores: 'mismatch', reason: 'run.json changed since the run started' };
  // Files of a call that crashed before its row are extra, not recorded: a resume calls it again.
  const open = { ...files };
  for (const rel of OPEN_VOLATILE) delete open[rel];
  const changed = firstDiff(run.files, open, { extraOk: true });
  if (changed) return { state: 'untrusted', scores: 'mismatch', reason: `${changed} since its row was recorded` };
  const { lines } = rowLines(runDir);
  if (lines.length < run.lines.length) return { state: 'untrusted', scores: 'mismatch', reason: 'raw.jsonl lost rows that the ledger recorded' };
  const bad = run.lines.findIndex((sha, index) => sha !== lines[index]);
  if (bad >= 0) return { state: 'untrusted', scores: 'mismatch', reason: `raw.jsonl line ${bad + 1} is not the row the ledger recorded` };
  // The runner writes a row, then its ledger entry: a crash between leaves one last row
  // with no entry. A resume drops it, as it drops a torn line, and calls it again.
  if (lines.length > run.lines.length + 1) return { state: 'untrusted', scores: 'mismatch', reason: `raw.jsonl line ${run.lines.length + 2} is not in the ledger` };
  return { state: 'open', ...scoreState, ...(lines.length === run.lines.length + 1 ? { unrecorded_last: true } : {}) };
}

/** The evidence can be read: legacy, trusted, open or halted (shown, flagged when halted). */
export const evidenceOk = (trust) => trust.state !== 'untrusted';
/** Its scores count: trusted (or no ledger in use), and they match their entry. */
export const scoresCount = (trust) => (trust.state === 'trusted' || trust.state === 'legacy') && trust.scores === 'match';

/** Record a closed run (close) or a vouched-for run (adopt). */
export function closeEntry(kind, runId, runDir, extra = {}) {
  return { kind, run_id: runId, files: runFiles(runDir).files, lines: rowLines(runDir).lines, ...extra };
}

export function scoresEntry(runId, runDir) {
  return { kind: 'scores', run_id: runId, files: runFiles(runDir).scores };
}

/** Adopt runs as they are now: their files, rows and scores. Returns the run ids adopted. */
export function adoptRuns(file, dirs, { only = null, extra = {} } = {}) {
  const adopted = [];
  for (const { name, dir } of dirs) {
    let runId;
    try {
      runId = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')).run_id;
    } catch {
      continue; // No readable run.json: not a run.
    }
    if (runId !== name || (only && !only.has(runId))) continue;
    appendEntry(file, closeEntry('adopt', runId, dir, extra));
    const scores = scoresEntry(runId, dir);
    if (Object.keys(scores.files).length) appendEntry(file, scores);
    adopted.push(runId);
  }
  return adopted;
}

/** Every run the ledger covers: the stores of this checkout, and the main checkout's results/. */
export function ledgerRunDirs(root) {
  const main = mainCheckout(root);
  const extra = main ? listDirs(path.join(main, 'results')).map((name) => ({ name, dir: path.join(main, 'results', name) })) : [];
  return [...runDirs(root), ...extra];
}

/**
 * Create the ledger when it does not exist yet: every run already stored is adopted as it
 * is now, the main checkout's results/ included. Called by the commands that hold the
 * store locks, before any call. Returns the number of runs adopted, or null when a ledger
 * already exists.
 */
export function ensureLedger(root, { log = () => {} } = {}) {
  const file = ledgerPath(root);
  const dirs = ledgerRunDirs(root);
  if (fs.existsSync(file)) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '', { flag: 'wx' });
  const seen = new Set();
  const unique = dirs.filter(({ name }) => !seen.has(name) && seen.add(name));
  const count = adoptRuns(file, unique, { extra: { by: 'ledger-created' } }).length;
  log(`  note: created the evidence ledger ${LEDGER_FILE}; ${count} stored run(s) recorded as they are now`);
  return count;
}
