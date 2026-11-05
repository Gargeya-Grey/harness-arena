// Semantic versions: major.minor.patch, optional -prerelease, optional +build.
const ID = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)';
const SEMVER = new RegExp(`^v?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${ID}(?:\\.${ID})*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$`);

export function parse(text) {
  const match = SEMVER.exec(String(text).trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [],
    build: match[5] ? match[5].split('.') : [],
  };
}

export function valid(text) {
  return parse(text) !== null;
}

function asVersion(value) {
  const version = typeof value === 'string' ? parse(value) : value;
  if (!version) throw new Error(`invalid version: ${value}`);
  return version;
}

// -1, 0 or 1. Build metadata is ignored.
export function compare(a, b) {
  const x = asVersion(a);
  const y = asVersion(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  if (!x.prerelease.length && !y.prerelease.length) return 0;
  if (!x.prerelease.length) return 1;
  if (!y.prerelease.length) return -1;
  const left = x.prerelease.join('.');
  const right = y.prerelease.join('.');
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sort(versions) {
  return [...versions].sort(compare);
}

export function rsort(versions) {
  return [...versions].sort((a, b) => compare(b, a));
}
