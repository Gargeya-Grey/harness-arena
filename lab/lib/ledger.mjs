// The evidence ledger: a record, outside the run store, of what each run wrote. The
// workdir guard can only notice a change while it watches; the ledger makes a run edited
// between commands show later, whenever it is read. It detects; it does not prevent: a
// process that outlives its agent call can still write to it (see README, the ledger).
//
// The ledger is lab.ledger.jsonl at the main checkout (every worktree shares it), not in
// the data folder: a forgery must then change two places, and the guard watches both
// during every agent call. It is compact JSONL, one entry per line, and only grows:
//   open    a run started; `core` is the sha256 of run.json without its changing fields
//   resume  a resume reopened a run, before it wrote anything: the rows it keeps and its files
//   row     one row was written: the sha256 of its line, of every file the call wrote, and the
//           size and sha256 of harness-events.ndjson after its events
//   halt    the guard stopped the run (written before the run closes)
//   close   the run closed: the sha256 of every file but scores/, and of every row line
//   adopt   a run vouched for as it is: when the ledger is created, or by `node lab adopt`
//   scores  the scores/ files a score command wrote for a run (sha256 each)
// All or nothing: a run counts in an aggregate only when it is closed, every file matches
// its last close or adopt entry, and its scores match its last scores entry exactly (a
// scores/ file of its evaluators that no score command recorded is a mismatch). Any other
// run is listed and counts nowhere. A run still open (or crashed) is checked as far as it
// goes, so a resume can continue it: its run.json core, every recorded file and row, and
// the recorded start of its events must match. A run with a halt entry is halted,
// whatever run.json says. Scores are derived: `node lab score` recomputes and records
// them. Only the files of the run's own evaluators are scores; any other file in scores/
// is never read. No ledger file at all: every run counts as before. A ledger that exists
// but cannot be read trusts no run.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './fsutil.mjs';
import { listDirs } from './fsutil.mjs';
import { checkouts, mainCheckout, runDirs } from './repo.mjs';
import { listTree } from './workspace.mjs';

export const LEDGER_FILE = 'lab.ledger.jsonl';
export const LEDGER_SCHEMA = 'ledger.schema.json';
// Run files the runner keeps writing while a run is open; the ledger checks them at close.
const OPEN_VOLATILE = new Set(['run.json', 'raw.jsonl', 'harness-events.ndjson']);

export function ledgerPath(root) {
  return path.join(mainCheckout(root) ?? root, LEDGER_FILE);
}

/** The size and sha256 of the first `size` bytes of harness-events.ndjson (all by default). */
export function eventsState(runDir, size = null) {
  let bytes = Buffer.alloc(0);
  try {
    bytes = fs.readFileSync(path.join(runDir, 'harness-events.ndjson'));
  } catch {
    bytes = Buffer.alloc(0);
  }
  const part = size == null ? bytes : bytes.subarray(0, size);
  return { size: part.length, sha256: sha256(part) };
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

/** The scores/ files a run's own evaluators write; nothing else in scores/ is read. */
export const scoreFileNames = (manifest) => new Set((manifest?.evaluators || []).map((spec) => `scores/${spec.id}@${spec.version}.jsonl`));
const pick = (object, keys) => Object.fromEntries(Object.entries(object || {}).filter(([key]) => keys.has(key)));

function readManifest(runDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  } catch {
    return null;
  }
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
  let stat = null;
  try {
    stat = fs.lstatSync(file);
  } catch {
    stat = null;
  }
  const prefix = before ?? Buffer.alloc(0);
  let aside = null;
  if (stat && !stat.isFile()) {
    // A folder or a link in place of the ledger: moved aside as it is.
    aside = path.join(dir, asideName);
    fs.renameSync(file, aside);
  } else if (stat) {
    let now = null;
    try {
      now = fs.readFileSync(file);
    } catch {
      now = null;
    }
    if (!now || !now.equals(prefix)) {
      aside = path.join(dir, asideName);
      if (now) fs.writeFileSync(aside, now, { flag: 'wx' });
      else aside = null;
    }
    // Windows refuses a rename onto a read-only file. A read-only ledger, or one with a
    // second link, is renamed out of the way and never chmodded: a chmod through a hard
    // link would change the other file too.
    if (!(stat.mode & 0o200) || stat.nlink > 1) {
      const out = path.join(dir, aside ? `.${asideName}.link` : asideName);
      fs.renameSync(file, out);
      aside = aside ?? out;
    }
  }
  const text = Buffer.concat([prefix, Buffer.from(`${prefix.length && prefix[prefix.length - 1] !== 0x0a ? '\n' : ''}${entryText(entry)}`, 'utf8')]);
  const temp = path.join(dir, `.${LEDGER_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temp, text, { flag: 'wx' });
  fs.renameSync(temp, file);
  return aside;
}

/**
 * Every run in the ledger: Map run_id -> { files, lines, closed, halted, scores, core }.
 * Null when there is no ledger. Lines that do not parse (a torn write, or an edit) are
 * returned in `torn`: their entries are lost, which can only make a run less trusted.
 * Entries that parse but do not fit are returned as problems.
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
  const torn = [];
  const entries = [];
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      torn.push({ line: index + 1, message: `invalid JSON: ${error.message}` });
      return;
    }
    entries.push({ line: index + 1, entry });
    const id = entry?.run_id;
    if (typeof id !== 'string') {
      problems.push({ line: index + 1, message: 'entry has no run_id' });
      return;
    }
    if (!runs.has(id)) runs.set(id, { files: {}, lines: [], closed: false, halted: null, scores: null, core: null, events: null });
    const run = runs.get(id);
    switch (entry.kind) {
      case 'open':
        Object.assign(run, { files: {}, lines: [], closed: false, core: entry.core ?? null, scores: null, events: null });
        break;
      case 'resume':
        // A resume makes the run's old scores stale: they count again only once rescored.
        Object.assign(run, { files: { ...(entry.files || {}) }, lines: [...(entry.lines || [])], closed: false, core: entry.core ?? null, scores: null, events: entry.events ?? null });
        break;
      case 'row':
        run.lines.push(entry.sha256);
        Object.assign(run.files, entry.files || {});
        run.closed = false;
        if (entry.events) run.events = entry.events;
        break;
      case 'halt':
        run.halted = entry.reason || 'left_workdir';
        break;
      case 'close':
      case 'adopt':
        Object.assign(run, { files: { ...(entry.files || {}) }, lines: [...(entry.lines || [])], closed: true, core: null, events: null });
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
  return { runs, problems, torn, entries };
}

/**
 * The ledger for the readers (state, validate, score, resume, adopt). No file: null, and
 * every run reads as before. A file that cannot be read: a ledger that trusts no run.
 */
export function loadLedger(file) {
  try {
    return readLedger(file);
  } catch (error) {
    return { unreadable: error.code || error.message, runs: new Map(), problems: [], torn: [], entries: [] };
  }
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
  if (ledger.unreadable) return { state: 'untrusted', scores: 'mismatch', reason: `the evidence ledger cannot be read (${ledger.unreadable})` };
  if (path.basename(runDir) !== runId) return { state: 'untrusted', scores: 'mismatch', reason: `its folder ${path.basename(runDir)} is not named after its run_id` };
  const run = ledger.runs.get(runId);
  if (!run) return { state: 'untrusted', scores: 'mismatch', reason: 'it is not in the ledger: it was not written by the lab runner, or was copied in (node lab adopt vouches for it)' };
  const manifest = readManifest(runDir);
  const { files, scores: allScores } = runFiles(runDir);
  const names = scoreFileNames(manifest);
  const scoreDiff = firstDiff(pick(run.scores, names), pick(allScores, names));
  const stray = Object.keys(allScores).filter((rel) => !names.has(rel));
  const scoreState = {
    ...(scoreDiff ? { scores: 'mismatch', scores_reason: `${scoreDiff} since the scores were recorded` } : { scores: 'match' }),
    ...(stray.length ? { stray_scores: stray } : {}),
  };
  if (run.halted) return { state: 'halted', reason: run.halted, ...scoreState };
  if (run.closed) {
    const changed = firstDiff(run.files, files);
    if (changed) return { state: 'untrusted', scores: 'mismatch', reason: `${changed} since the run closed` };
    // Fully scored or not counted: every declared evaluator needs a recorded score file.
    const missing = [...names].filter((rel) => !run.scores || !(rel in run.scores));
    if (missing.length) return { state: 'trusted', scores: 'mismatch', scores_reason: `the run has no recorded scores for ${missing.join(', ')}`, ...(stray.length ? { stray_scores: stray } : {}) };
    return { state: 'trusted', ...scoreState };
  }
  if (run.core && (!manifest || manifestCore(manifest) !== run.core)) return { state: 'untrusted', scores: 'mismatch', reason: 'run.json changed since the run started' };
  // Files of a call that crashed before its row are extra, not recorded: a resume calls it again.
  const open = { ...files };
  for (const rel of OPEN_VOLATILE) delete open[rel];
  const changed = firstDiff(run.files, open, { extraOk: true });
  if (changed) return { state: 'untrusted', scores: 'mismatch', reason: `${changed} since its row was recorded` };
  if (run.events) {
    const now = eventsState(runDir, run.events.size);
    if (now.size < run.events.size) return { state: 'untrusted', scores: 'mismatch', reason: 'harness-events.ndjson lost events that the ledger recorded' };
    if (now.sha256 !== run.events.sha256) return { state: 'untrusted', scores: 'mismatch', reason: 'harness-events.ndjson changed since its row was recorded' };
  }
  const { lines } = rowLines(runDir);
  if (lines.length < run.lines.length) return { state: 'untrusted', scores: 'mismatch', reason: 'raw.jsonl lost rows that the ledger recorded' };
  const bad = run.lines.findIndex((sha, index) => sha !== lines[index]);
  if (bad >= 0) return { state: 'untrusted', scores: 'mismatch', reason: `raw.jsonl line ${bad + 1} is not the row the ledger recorded` };
  // The runner writes a row, then its ledger entry: a crash between leaves one last row
  // with no entry. A resume drops it, as it drops a torn line, and calls it again.
  if (lines.length > run.lines.length + 1) return { state: 'untrusted', scores: 'mismatch', reason: `raw.jsonl line ${run.lines.length + 2} is not in the ledger` };
  return { state: 'open', ...scoreState, ...(lines.length === run.lines.length + 1 ? { unrecorded_last: true } : {}) };
}

/** All or nothing: the run counts in aggregates (rows and scores) only when it is closed, every file matches and every declared evaluator's scores are recorded and match. Without a ledger no run counts. */
export const runCounts = (trust) => trust.state === 'trusted' && trust.scores === 'match';

/** Record a closed run (close) or a vouched-for run (adopt). */
export function closeEntry(kind, runId, runDir, extra = {}) {
  return { kind, run_id: runId, files: runFiles(runDir).files, lines: rowLines(runDir).lines, ...extra };
}

/** The scores entry: the files a score command wrote (`written`), or, for an adopt, every scores/ file of the run's evaluators. */
export function scoresEntry(runId, runDir, manifest = readManifest(runDir), written = null) {
  return { kind: 'scores', run_id: runId, files: pick(runFiles(runDir).scores, written ? new Set(written) : scoreFileNames(manifest)) };
}

/** Adopt runs as they are now: their files, rows and scores. Returns the run ids adopted. */
export function adoptRuns(file, dirs, { only = null, extra = {} } = {}) {
  const adopted = [];
  for (const { name, dir } of dirs) {
    const manifest = readManifest(dir);
    const runId = manifest?.run_id;
    if (!runId) continue; // No readable run.json: not a run.
    if (runId !== name || (only && !only.has(runId))) continue;
    appendEntry(file, closeEntry('adopt', runId, dir, extra));
    // Always a scores entry: an adopt vouches for the scores as they are, none included.
    appendEntry(file, scoresEntry(runId, dir, manifest));
    adopted.push(runId);
  }
  return adopted;
}

/** Every run the ledger covers: the stores of this checkout, and results/ of every checkout. */
export function ledgerRunDirs(root) {
  const extra = checkouts(root).flatMap((checkout) => listDirs(path.join(checkout, 'results')).map((name) => ({ name, dir: path.join(checkout, 'results', name) })));
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
  const seen = new Set();
  const unique = dirs.filter(({ name }) => !seen.has(name) && seen.add(name));
  // Written whole to a new file, then renamed: a command killed half way leaves no ledger
  // that knows only some of the runs.
  const temp = path.join(path.dirname(file), `.${LEDGER_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temp, '', { flag: 'wx' });
  let count;
  try {
    count = adoptRuns(temp, unique, { extra: { by: 'ledger-created' } }).length;
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  log(`  note: created the evidence ledger ${LEDGER_FILE}; ${count} stored run(s) recorded as they are now`);
  return count;
}
