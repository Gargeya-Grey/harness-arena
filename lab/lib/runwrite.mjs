// Writes into a run folder never go through a link. Every folder from the run folder down
// to the file must be a plain folder (a junction or a symbolic link there would send the
// write into another run), and a file is never written through a hard link: a whole file
// is written to a new file and renamed into place, and a file that is appended to is
// first copied to a file of its own when it has a second link.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** The path of `rel` inside runDir, after checking (and making) every folder on the way. */
export function runPath(runDir, rel) {
  const parts = rel.split('/').filter(Boolean);
  const top = fs.lstatSync(runDir);
  if (top.isSymbolicLink() || !top.isDirectory()) throw new Error(`the run folder ${path.basename(runDir)} is not a plain folder`);
  let dir = runDir;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    let stat = null;
    try {
      stat = fs.lstatSync(dir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!stat) fs.mkdirSync(dir);
    else if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${parts.slice(0, parts.indexOf(part) + 1).join('/')} in the run folder is not a plain folder`);
  }
  return path.join(runDir, ...parts);
}

/** Make a run file safe to append to: a plain file with one link (or not there yet). */
export function own(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return file; // Not there yet.
  }
  if (!stat.isFile()) throw new Error(`${path.basename(file)} in the run folder is not a plain file`);
  // A read-only file with a second link: making it writable would change the other file too.
  if (stat.nlink > 1 && !(stat.mode & 0o200)) throw new Error(`${path.basename(file)} in the run folder is a read-only hard link; it is not written`);
  if (!(stat.mode & 0o200)) fs.chmodSync(file, 0o666);
  if (stat.nlink > 1) {
    const copy = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(copy, fs.readFileSync(file), { flag: 'wx' });
    fs.rmSync(file, { force: true });
    fs.renameSync(copy, file);
  }
  return file;
}

/** Append text to a run file. */
export function appendRunFile(runDir, rel, text) {
  fs.appendFileSync(own(runPath(runDir, rel)), text, 'utf8');
}

/** Write a whole run file: a new file, renamed over the old one (never written through it). */
export function writeRunFile(runDir, rel, text) {
  const file = runPath(runDir, rel);
  let stat = null;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (stat && stat.isDirectory() && !stat.isSymbolicLink()) throw new Error(`${rel} in the run folder is a folder`);
  // Windows refuses a rename onto a read-only file. A read-only file with a second link is
  // refused: making it writable would change the other file too.
  if (stat?.isFile() && !(stat.mode & 0o200)) {
    if (stat.nlink > 1) throw new Error(`${rel} in the run folder is a read-only hard link; it is not written`);
    fs.chmodSync(file, 0o666);
  }
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temp, text, { flag: 'wx' });
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return file;
}
