// A temporary home folder for one isolated CLI call. It holds only the sign-in
// files the CLI needs, copied from the real home. The folder is deleted after
// the call, so config, instructions, skills and MCP files never reach the CLI.
//
// Rules:
// - Only the listed files are copied. Nothing else is read.
// - A missing sign-in file is an `auth` error. The call never falls back to the real home.
// - A CLI may refresh its token while it runs and write the new token to the copy.
//   Some providers rotate the refresh token, so losing the copy could lock the
//   owner out. After the call, a changed copy that still parses as JSON goes back
//   to the real home, unless something else changed the real file meanwhile.
// - A CLI whose sign-in is not a file (OpenCode keeps it in rows of a database) gives a
//   `store`: { label, missing(homeDir), seed({homeDir, dir, env}), writeBack({homeDir, dir, state, home}) }.
//   It follows the same rules: copy the sign-in only, never fall back, write back only a safe change.
// - Errors and records name files relative to the home (".codex/auth.json"),
//   never the real path and never file contents.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TEMP_HOME_LABEL = '<temp home>';
const PREFIX = 'lab-home-';

const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const readIfFile = (file) => {
  try {
    return fs.statSync(file).isFile() ? fs.readFileSync(file) : null;
  } catch {
    return null;
  }
};
const validJson = (buffer) => {
  try {
    JSON.parse(buffer.toString('utf8'));
    return true;
  } catch {
    return false;
  }
};

/** Sign-in files from `files` (and a store, if any) that are missing in `homeDir` (names only). */
export function missingSignIn(files, homeDir = os.homedir(), store = null) {
  return [...files.filter((rel) => readIfFile(path.join(homeDir, rel)) === null), ...(store ? store.missing(homeDir) : [])];
}

/** The env record of an isolation: `KEY=<temp home>/sub`, never a real path. */
export function describeEnv(env) {
  return Object.entries(env(TEMP_HOME_LABEL)).map(([key, value]) => `${key}=${String(value).replace(/\\/g, '/')}`);
}

/** Replace the temp folder in a text with a label, so records never hold it. */
export function scrubTempHome(text, dir) {
  if (typeof text !== 'string' || !dir) return text;
  const forms = new Set([dir, dir.replace(/\\/g, '/'), dir.replace(/\//g, '\\')]);
  let out = text;
  for (const form of forms) out = out.split(form).join(TEMP_HOME_LABEL);
  return out;
}

function removeFolder(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // A process the CLI started may still hold a file; the report says it was not removed.
  }
  return !fs.existsSync(dir);
}

/**
 * Run `fn(tempHome)` with a new temp home that holds a copy of `files`.
 *   files      sign-in files, relative to the real home (the same path is used in the temp home)
 *   writeBack  copy a refreshed sign-in file back after the call
 *   homeDir    the real home (default: the current user's home)
 *   tmpRoot    where the temp home goes (default: os.tmpdir())
 *   store      optional sign-in that is not a file (see the top of this file)
 *   env        (tempHome) => env vars of the call; a store may need them to start the CLI once
 * Returns { error } when a sign-in file is missing or a store cannot seed (fn is not called), else
 * { value, home: { removed, written_back, kept } } with file names only.
 * The folder is deleted when fn succeeds, fails or throws.
 */
export async function runInTempHome({ files, writeBack = true, homeDir = os.homedir(), tmpRoot = os.tmpdir(), store = null, env = () => ({}) }, fn) {
  const missing = missingSignIn(files, homeDir, store);
  if (missing.length) {
    return { error: { type: 'auth', message: `Isolated mode needs the sign-in file ${missing.join(', ')} in your home folder. Sign in with the CLI once, then run again. The real home is not used as a fallback.` } };
  }
  const dir = fs.mkdtempSync(path.join(tmpRoot, PREFIX));
  const home = { removed: false, written_back: [], kept: [] };
  let value;
  const copied = new Map();
  let state = null;
  let ran = false;
  try {
    for (const rel of files) {
      const buffer = fs.readFileSync(path.join(homeDir, rel));
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer, { mode: 0o600 });
      copied.set(rel, digest(buffer));
    }
    state = store ? await store.seed({ homeDir, dir, env: env(dir) }) : null;
    if (state?.error) return { error: state.error }; // the folder is removed below
    ran = true;
    value = await fn(dir);
  } finally {
    // Runs after success, a failed call and a thrown error alike. The CLI may have
    // rotated its refresh token even when the call or its parser failed afterwards, so
    // the write-back comes first, then the folder goes.
    if (ran && writeBack) {
      try {
        for (const [rel, before] of copied) writeBackFile({ dir, homeDir, rel, before, home });
        if (store) await store.writeBack({ homeDir, dir, state, home });
      } catch (error) {
        home.kept.push(`write-back failed: ${error?.message || error}`);
      }
    }
    home.removed = removeFolder(dir);
    if (!home.removed) {
      // This folder holds a copy of the sign-in; say where, so the owner can delete it.
      process.stderr.write(`warning: could not delete the temp home ${dir}; it holds a copy of your sign-in. Delete it by hand.\n`);
    }
  }
  return { value, home };
}

// A refreshed token: copy it back only when it changed, still parses as JSON, and
// the real file is still the one that was copied (another process may have refreshed it).
function writeBackFile({ dir, homeDir, rel, before, home }) {
  const after = readIfFile(path.join(dir, rel));
  if (!after || digest(after) === before) return;
  if (!validJson(after)) {
    home.kept.push(`${rel} (changed copy is not valid JSON; not written back)`);
    return;
  }
  const real = path.join(homeDir, rel);
  const now = readIfFile(real);
  if (!now || digest(now) !== before) {
    home.kept.push(`${rel} (real file changed during the call; not overwritten)`);
    return;
  }
  const staging = `${real}.lab-${process.pid}.tmp`;
  try {
    fs.writeFileSync(staging, after, { mode: 0o600 });
    fs.renameSync(staging, real);
    home.written_back.push(rel);
  } catch {
    fs.rmSync(staging, { force: true });
    home.kept.push(`${rel} (write back failed)`);
  }
}
