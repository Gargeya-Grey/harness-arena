import { compare, parse } from './semver.mjs';

// A range is comparator sets joined by ||. A set is comparators joined by
// spaces; a version must pass all of them. Supported: 1.2.3, =1.2.3, >, >=, <,
// <=, ^1.2.3, ~1.2.3, 1.x, 1.2.*, *, '' and hyphen ranges (1.2.3 - 2.3.4).
// A prerelease version only satisfies a set that names a prerelease of the
// same major.minor.patch.
const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const isWild = (part) => part === undefined || /^[xX*]$/.test(part);

function parsePartial(text) {
  const match = PARTIAL.exec(text);
  if (!match) throw new Error(`invalid version in range: ${text}`);
  const [, major, minor, patch, pre] = match;
  if (isWild(major)) return { major: null, minor: null, patch: null, pre: null };
  if (isWild(minor)) return { major: Number(major), minor: null, patch: null, pre: null };
  if (isWild(patch)) return { major: Number(major), minor: Number(minor), patch: null, pre: null };
  return { major: Number(major), minor: Number(minor), patch: Number(patch), pre: pre ?? null };
}

const version = (major, minor, patch, pre = null) => ({
  major,
  minor,
  patch,
  prerelease: pre ? pre.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [],
});
const lower = (p) => ({ op: '>=', version: version(p.major ?? 0, p.minor ?? 0, p.patch ?? 0, p.pre) });
const below = (major, minor, patch) => ({ op: '<', version: version(major, minor, patch) });
const ANY = [{ op: '>=', version: version(0, 0, 0) }];

function caret(p) {
  if (p.major === null) return ANY;
  if (p.minor === null) return [lower(p), below(p.major + 1, 0, 0)];
  if (p.patch === null) return [lower(p), p.major > 0 ? below(p.major + 1, 0, 0) : below(0, p.minor + 1, 0)];
  if (p.major > 0) return [lower(p), below(p.major + 1, 0, 0)];
  if (p.minor > 0) return [lower(p), below(0, p.minor + 1, 0)];
  return [lower(p), below(0, 0, p.patch + 1)];
}

function tilde(p) {
  if (p.major === null) return ANY;
  if (p.minor === null) return [lower(p), below(p.major + 1, 0, 0)];
  return [lower(p), below(p.major, p.minor + 1, 0)];
}

function exact(p) {
  if (p.major === null) return ANY;
  if (p.minor === null) return [lower(p), below(p.major + 1, 0, 0)];
  if (p.patch === null) return [lower(p), below(p.major, p.minor + 1, 0)];
  return [{ op: '=', version: version(p.major, p.minor, p.patch, p.pre) }];
}

function operator(op, p) {
  if (p.major === null) return op === '<' || op === '>' ? [{ op: '<', version: version(0, 0, 0) }] : ANY;
  if (op === '>=') return [lower(p)];
  if (op === '<') return [{ op: '<', version: version(p.major, p.minor ?? 0, p.patch ?? 0, p.pre) }];
  if (op === '>') {
    if (p.minor === null) return [{ op: '>=', version: version(p.major + 1, 0, 0) }];
    if (p.patch === null) return [{ op: '>=', version: version(p.major, p.minor + 1, 0) }];
    return [{ op: '>', version: version(p.major, p.minor, p.patch, p.pre) }];
  }
  if (op === '<=') {
    if (p.minor === null) return [below(p.major + 1, 0, 0)];
    if (p.patch === null) return [below(p.major, p.minor + 1, 0)];
    return [{ op: '<=', version: version(p.major, p.minor, p.patch, p.pre) }];
  }
  throw new Error(`invalid operator ${op}`);
}

function hyphen(from, to) {
  const start = lower(parsePartial(from));
  const end = parsePartial(to);
  if (end.major === null) return [start];
  if (end.minor === null) return [start, below(end.major + 1, 0, 0)];
  if (end.patch === null) return [start, below(end.major, end.minor + 1, 0)];
  return [start, { op: '<=', version: version(end.major, end.minor, end.patch, end.pre) }];
}

function parseSet(text) {
  const hyphenated = /^(\S+)\s+-\s+(\S+)$/.exec(text);
  if (hyphenated) return hyphen(hyphenated[1], hyphenated[2]);
  const tokens = text.replace(/([<>=~^]+)\s+/g, '$1').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return ANY;
  return tokens.flatMap((token) => {
    const match = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(token);
    const p = parsePartial(match[2]);
    if (match[1] === '^') return caret(p);
    if (match[1] === '~') return tilde(p);
    if (match[1] === undefined || match[1] === '=') return exact(p);
    return operator(match[1], p);
  });
}

export function parseRange(text) {
  return String(text).trim().split('||').map((set) => parseSet(set.trim()));
}

function passes(comparator, v) {
  const order = compare(v, comparator.version);
  if (comparator.op === '=') return order === 0;
  if (comparator.op === '>') return order > 0;
  if (comparator.op === '>=') return order >= 0;
  if (comparator.op === '<') return order < 0;
  return order <= 0;
}

function setSatisfies(set, v) {
  if (!set.every((comparator) => passes(comparator, v))) return false;
  if (v.prerelease.length === 0) return true;
  return set.some((c) => c.version.prerelease.length > 0 && c.version.major === v.major && c.version.minor === v.minor && c.version.patch === v.patch);
}

export function satisfies(text, range) {
  const sets = parseRange(range);
  const v = parse(text);
  if (!v) return false;
  return sets.some((set) => setSatisfies(set, v));
}

// The highest version in the list that satisfies the range, or null.
export function maxSatisfying(versions, range) {
  let best = null;
  for (const candidate of versions) {
    if (!satisfies(candidate, range)) continue;
    if (best === null || compare(candidate, best) > 0) best = candidate;
  }
  return best;
}
