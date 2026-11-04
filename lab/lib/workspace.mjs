// Agent tasks: a starter workspace is copied into the call's folder, the agent
// edits it, and the runner stores what changed as evidence under the run. The
// evaluator rebuilds the final workspace from that evidence alone, so scores can
// be computed again later with no model call.

import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './fsutil.mjs';
import { redactPaths } from './redact.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules']);
export const WORKSPACE_LIMITS = { files: 200, fileBytes: 1024 * 1024, totalBytes: 5 * 1024 * 1024 };
// Invariant 7: no name that Windows cannot store.
const UNSAFE_NAME = /[:?*"<>|\\]|[\u0000-\u001f]/;
const UNSAFE_NAME_ALL = new RegExp(UNSAFE_NAME.source, 'g');

/** Relative POSIX paths of every regular file under dir, sorted. Skips .git and node_modules; never follows links. */
export function listTree(dir, skipDirs = SKIP_DIRS) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(path.join(abs, entry.name), next);
      } else if (entry.isFile()) {
        out.push(next);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out.sort();
}

export function copyTree(from, to) {
  for (const rel of listTree(from)) {
    const target = path.join(to, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(from, ...rel.split('/')), target);
  }
}

/** Content hash of a folder: path and bytes of every file, in order. */
export function treeHash(dir) {
  const parts = [];
  for (const rel of listTree(dir)) parts.push(Buffer.from(`${rel}\0`), fs.readFileSync(path.join(dir, ...rel.split('/'))), Buffer.from('\0'));
  return sha256(Buffer.concat(parts));
}

/**
 * A fingerprint of folders: the content hash of every file, so a change that keeps
 * size and modification time still shows.
 * The runner takes one before and one after an agent call; `stampDiff` names the
 * first path that differs. `skip` holds absolute folders to leave out.
 */
export function treeStamp(root, folders, skip = []) {
  const stamp = new Map();
  const skipped = skip.map((item) => path.resolve(item));
  for (const folder of folders) {
    const abs = path.join(root, folder);
    for (const rel of listTree(abs)) {
      const file = path.join(abs, ...rel.split('/'));
      if (skipped.some((item) => file === item || file.startsWith(item + path.sep))) continue;
      try {
        stamp.set(`${folder}/${rel}`, sha256(fs.readFileSync(file)));
      } catch {
        stamp.set(`${folder}/${rel}`, 'unreadable');
      }
    }
  }
  return stamp;
}

export function stampDiff(before, after) {
  for (const [key, value] of before) if (after.get(key) !== value) return key;
  for (const key of after.keys()) if (!before.has(key)) return key;
  return null;
}

/** True when rel is a plain relative path that stays inside its folder. */
export function isInsidePath(rel) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return false;
  return rel.split('/').every((part) => part && part !== '.' && part !== '..' && !UNSAFE_NAME.test(part));
}

function isText(buffer) {
  return !buffer.includes(0) && Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer);
}

/**
 * Store what the agent changed in workDir, compared with fixtureDir, under
 * runDir/base: files/<path> for every added or changed file, and workspace.json
 * listing changed, deleted and skipped paths. `fixtureSha` is the starter's hash,
 * taken before the call. Text files have home paths removed, as answers do.
 * Returns the artifact for raw.jsonl.
 */
export function snapshotWorkspace({ fixtureDir, fixtureSha, workDir, runDir, base, artifactId, createdAt }) {
  const before = new Set(listTree(fixtureDir));
  const after = listTree(workDir);
  const changed = [];
  const skipped = [];
  let total = 0;
  for (const rel of after) {
    const file = path.join(workDir, ...rel.split('/'));
    const size = fs.statSync(file).size;
    if (!isInsidePath(rel)) {
      skipped.push({ path: rel.replace(UNSAFE_NAME_ALL, '_'), bytes: size, reason: 'unsafe name' });
      continue;
    }
    if (size > WORKSPACE_LIMITS.fileBytes) {
      skipped.push({ path: rel, bytes: size, reason: 'file too large' });
      continue;
    }
    let now = fs.readFileSync(file);
    if (before.has(rel) && now.equals(fs.readFileSync(path.join(fixtureDir, ...rel.split('/'))))) continue;
    if (changed.length >= WORKSPACE_LIMITS.files || total + now.length > WORKSPACE_LIMITS.totalBytes) {
      skipped.push({ path: rel, bytes: now.length, reason: 'workspace limit' });
      continue;
    }
    if (isText(now)) now = Buffer.from(redactPaths(now.toString('utf8')), 'utf8');
    const target = path.join(runDir, base, 'files', ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, now);
    total += now.length;
    changed.push(rel);
  }
  const present = new Set(after);
  const deleted = [...before].filter((rel) => !present.has(rel));
  const manifest = { fixture_sha256: fixtureSha ?? treeHash(fixtureDir), changed, deleted, skipped };
  const manifestRel = `${base}/workspace.json`;
  const text = `${JSON.stringify(manifest)}\n`;
  fs.mkdirSync(path.join(runDir, base), { recursive: true });
  fs.writeFileSync(path.join(runDir, manifestRel), text, 'utf8');
  return { artifact_id: artifactId, role: 'raw', mime: 'application/json', path: manifestRel, sha256: sha256(text), derived: false, created_at: createdAt };
}

/**
 * Rebuild the agent's final workspace in dest from the fixture plus the stored
 * changes. A stored run is data from elsewhere: every path in it must stay inside
 * the run folder or dest, or the rebuild stops with an error.
 */
export function rebuildWorkspace({ fixtureDir, runDir, manifestPath, dest }) {
  if (!isInsidePath(manifestPath) || !manifestPath.endsWith('/workspace.json')) throw new Error(`workspace manifest path is not inside the run: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, ...manifestPath.split('/')), 'utf8'));
  const base = manifestPath.split('/').slice(0, -1);
  const lists = [manifest.changed, manifest.deleted].map((list) => (Array.isArray(list) ? list : []));
  for (const rel of lists.flat()) if (!isInsidePath(rel)) throw new Error(`workspace manifest has a path outside the workspace: ${String(rel).slice(0, 120)}`);
  copyTree(fixtureDir, dest);
  for (const rel of lists[1]) fs.rmSync(path.join(dest, ...rel.split('/')), { force: true, recursive: true });
  for (const rel of lists[0]) {
    const target = path.join(dest, ...rel.split('/'));
    // An agent may have turned a starter folder into a file, or the reverse.
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(runDir, ...base, 'files', ...rel.split('/')), target);
  }
  return manifest;
}
