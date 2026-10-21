import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function isoNow() {
  return new Date().toISOString();
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

export function readJson(file) {
  return JSON.parse(readText(file));
}

/**
 * Parse JSONL. Bad lines are returned in `problems` instead of thrown, so one
 * corrupt row never hides the rest of the evidence.
 */
export function readJsonl(file) {
  const rows = [];
  const problems = [];
  if (!fs.existsSync(file)) return { rows, problems };
  const lines = readText(file).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      problems.push({ file, line: index + 1, message: `Invalid JSON: ${error.message}` });
    }
  });
  return { rows, problems };
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function appendJsonl(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

export function safeSegment(value) {
  return String(value ?? 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (!ext || entry.name.endsWith(ext)))
    .map((entry) => entry.name)
    .sort();
}

/** Resolve `rel` inside `base`; null when it escapes. */
export function resolveInside(base, rel) {
  const root = path.resolve(base);
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}
