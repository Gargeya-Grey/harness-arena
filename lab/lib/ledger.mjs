// The evidence ledger: a record, outside the run store, of what each run wrote. The
// workdir guard can only notice a change while it watches; a ledger makes a forged or
// edited run show later, whenever it is read, however the change was made.
//
// The ledger is lab.ledger.jsonl at the main checkout (every worktree shares it), not in
// the data folder: a forgery must then change two places, and the guard watches both
// during every agent call. It is compact JSONL, one entry per line, and only grows:
//   open    a run started
//   row     one row was written to raw.jsonl (the sha256 of its line)
//   halt    the guard stopped the run (written first, before any other write)
//   close   the run closed: the sha256 of every file but scores/, and of every row line
//   adopt   a run that existed when the ledger was created (same fields as close)
//   scores  the scores/ files written for a run (sha256 each)
// A run is trusted when its files match its last close or adopt entry, and its scores
// match its last scores entry. A run with a halt entry is halted, whatever run.json says.
// No ledger file at all: the ledger is not in use yet, and every run reads as before.

import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './fsutil.mjs';
import { mainCheckout } from './repo.mjs';
import { listTree } from './workspace.mjs';

export const LEDGER_FILE = 'lab.ledger.jsonl';
export const LEDGER_SCHEMA = 'ledger.schema.json';

export function ledgerPath(root) {
  return path.join(mainCheckout(root) ?? root, LEDGER_FILE);
}

/** The exact line appendJsonl writes for a record, so the ledger can hash a row. */
export const rowLine = (record) => `${JSON.stringify(record)}\n`;
export const lineSha = (line) => sha256(line.endsWith('\n') ? line : `${line}\n`);

/**
 * Append one entry. The ledger must be a plain file with one link (or not exist yet), in
 * the folder the run started with: an entry is never written through a link or into a
 * redirected folder. A refused write throws; the run then has no close entry and reads
 * as not trusted (the ledger fails closed).
 */
export function appendEntry(file, entry, { realDir = null } = {}) {
  const dir = path.dirname(file);
  if (realDir && fs.realpathSync.native(dir) !== realDir) throw new Error(`the ledger folder ${dir} is not the folder the run started with`);
  let stat = null;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (stat && (!stat.isFile() || stat.nlink > 1)) throw new Error(`the ledger ${file} is not a plain file with one link`);
  fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

/**
 * Every run in the ledger: Map run_id -> { files, lines, closed, halted, scores, entries }.
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
    if (!runs.has(id)) runs.set(id, { files: null, lines: [], closed: false, halted: null, scores: null, opened: false });
    const run = runs.get(id);
    switch (entry.kind) {
      case 'open':
        run.opened = true;
        break;
      case 'row':
        run.lines.push(entry.sha256);
        run.closed = false;
        break;
      case 'halt':
        run.halted = entry.reason || 'left_workdir';
        break;
      case 'close':
      case 'adopt':
        run.files = entry.files || {};
        run.lines = [...(entry.lines || [])];
        run.closed = true;
        if (entry.halted) run.halted = run.halted || entry.halted;
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

// Hashing every stored file on every dashboard request is slow on a big store; a file
// that keeps its size and modification time keeps its hash.
const hashCache = new Map();
function fileSha(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) return `not a file`;
  const key = `${file}|${stat.size}|${stat.mtimeMs}`;
  if (!hashCache.has(key)) hashCache.set(key, sha256(fs.readFileSync(file)));
  return hashCache.get(key);
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

/** sha256 of each line of raw.jsonl, in order; a last line without a newline is torn. */
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

const firstDiff = (want, have) => {
  for (const key of Object.keys(want)) if (have[key] !== want[key]) return key in have ? `${key} changed` : `${key} is missing`;
  for (const key of Object.keys(have)) if (!(key in want)) return `${key} was added`;
  return null;
};

/**
 * How far a run can be trusted, from the ledger:
 *   { state: 'legacy' }      no ledger in use
 *   { state: 'trusted' }     its files match its last close or adopt entry
 *   { state: 'open' }        still being written (or crashed): every row line is in the ledger
 *   { state: 'halted', reason }
 *   { state: 'untrusted', reason }   not in the ledger, or a file does not match
 */
export function trustRun(ledger, runId, runDir) {
  if (!ledger) return { state: 'legacy' };
  const run = ledger.runs.get(runId);
  if (!run) return { state: 'untrusted', reason: 'it is not in the ledger: it was not written by the lab runner, or was copied in' };
  if (run.halted) return { state: 'halted', reason: run.halted };
  const { files, scores } = runFiles(runDir);
  if (run.closed) {
    const changed = firstDiff(run.files, files);
    if (changed) return { state: 'untrusted', reason: `${changed} since the run closed` };
  } else {
    const { lines } = rowLines(runDir);
    if (lines.length < run.lines.length) return { state: 'untrusted', reason: 'raw.jsonl lost rows that the ledger recorded' };
    const bad = run.lines.findIndex((sha, index) => sha !== lines[index]);
    if (bad >= 0) return { state: 'untrusted', reason: `raw.jsonl line ${bad + 1} is not the row the ledger recorded` };
    // The runner writes a row, then its ledger entry: a crash between leaves one last row
    // with no entry. A resume drops it, as it drops a torn line, and calls it again.
    if (lines.length > run.lines.length + 1) return { state: 'untrusted', reason: `raw.jsonl line ${run.lines.length + 2} is not in the ledger` };
    if (lines.length === run.lines.length + 1) return { state: 'open', unrecorded_last: true };
  }
  const scoreDiff = firstDiff(run.scores || {}, scores);
  if (scoreDiff) return { state: 'untrusted', reason: `${scoreDiff} (scores) since they were recorded` };
  return { state: run.closed ? 'trusted' : 'open' };
}

/** A trusted run, or one with no ledger in use: its scores count. */
export const scoresCount = (trust) => trust.state === 'trusted' || trust.state === 'legacy';

/** Record a closed run (close) or a run found when the ledger is created (adopt). */
export function closeEntry(kind, runId, runDir, extra = {}) {
  return { kind, run_id: runId, files: runFiles(runDir).files, lines: rowLines(runDir).lines, ...extra };
}

export function scoresEntry(runId, runDir) {
  return { kind: 'scores', run_id: runId, files: runFiles(runDir).scores };
}

/**
 * Create the ledger when it does not exist yet: every run already stored is adopted as it
 * is now. Called by the commands that hold the store lock, before any call. Returns the
 * number of runs adopted, or null when a ledger already exists.
 */
export function ensureLedger(file, dirs, { log = () => {} } = {}) {
  if (fs.existsSync(file)) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '', { flag: 'wx' });
  let count = 0;
  for (const { name, dir } of dirs) {
    let runId = name;
    try {
      runId = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')).run_id || name;
    } catch {
      continue; // No readable run.json: not a run.
    }
    appendEntry(file, closeEntry('adopt', runId, dir));
    const scores = scoresEntry(runId, dir);
    if (Object.keys(scores.files).length) appendEntry(file, scores);
    count += 1;
  }
  log(`  note: created the evidence ledger ${LEDGER_FILE}; ${count} stored run(s) recorded as they are now`);
  return count;
}
