// Every write into a run folder goes through lab/lib/runwrite.mjs, which never writes
// through a link. This lint fails on a raw fs write in lab/ that does not say why it is
// safe, so a new raw write into a run folder cannot slip in from one file.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Files that never write into a run folder, with the reason.
const OUTSIDE = {
  'lab/lib/runwrite.mjs': 'the one module that writes run folders',
  'lab/lib/ledger.mjs': 'writes lab.ledger.jsonl at the checkout',
  'lab/lib/lock.mjs': 'writes the lock file at the store root',
  'lab/lib/fsutil.mjs': 'generic helpers; the lint forbids them for run folders below',
  'lab/commands/info.mjs': 'writes no run folder',
  'lab/commands/new-case.mjs': 'writes datasets only',
};

const WRITE = /\bfs\.(writeFileSync|appendFileSync|chmodSync|truncateSync|ftruncateSync|rmSync|rmdirSync|renameSync|unlinkSync|copyFileSync|cpSync|mkdirSync|openSync|writeSync|symlinkSync|linkSync|utimesSync|createWriteStream)\b|\b(writeJson|appendJsonl)\(|fs\/promises/;
const SAFE = /\brunPath\(|\bown\(|\/\/ not a run (folder|file):/;

/** The lines of one source that write a file and do not say why that is safe. */
export function rawWrites(text) {
  return text.split('\n').flatMap((line, index) => (WRITE.test(line) && !SAFE.test(line) ? [`${index + 1}: ${line.trim()}`] : []));
}

function sources(dir) {
  return fs.readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(rel);
    return rel.endsWith('.mjs') ? [rel] : [];
  });
}

test('lint: lab/ writes a run folder only through lab/lib/runwrite.mjs', () => {
  const found = [];
  for (const rel of sources('lab')) {
    if (OUTSIDE[rel]) continue;
    for (const line of rawWrites(fs.readFileSync(path.join(REPO, rel), 'utf8'))) found.push(`${rel}:${line}`);
  }
  assert.deepEqual(found, [], 'use writeRunFile or appendRunFile from lab/lib/runwrite.mjs, or end the line with "// not a run folder: <why>"');
});

test('lint: it catches the raw run-folder writes that lab/lib/workspace.mjs had', () => {
  // The two lines snapshotWorkspace wrote into the run folder before it used writeRunFile.
  const past = ["    fs.writeFileSync(target, now);", "  fs.writeFileSync(path.join(runDir, manifestRel), text, 'utf8');"].join('\n');
  assert.deepEqual(rawWrites(past), ['1: fs.writeFileSync(target, now);', "2: fs.writeFileSync(path.join(runDir, manifestRel), text, 'utf8');"]);
  assert.deepEqual(rawWrites("  writeRunFile(runDir, manifestRel, text);\n  fs.rmSync(dir); // not a run folder: the call folder"), []);
});
