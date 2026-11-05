import { compare, parse } from './semver.mjs';

// A range is comparator sets joined by ||. A set is comparators joined by
// spaces; a version must pass all of them. Supported: 1.2.3, =1.2.3, >, >=, <,
// <=, ^1.2.3, ~1.2.3, * and ''.
function comparatorsFor(token) {
  if (token === '*' || token === '') return [{ op: '>=', version: parse('0.0.0') }];
  const match = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(token);
  const op = match[1] ?? '=';
  const v = parse(match[2]);
  if (!v) throw new Error(`invalid version in range: ${match[2]}`);
  if (op === '^') return [{ op: '>=', version: v }, { op: '<', version: parse(`${v.major + 1}.0.0`) }];
  if (op === '~') return [{ op: '>=', version: v }, { op: '<', version: parse(`${v.major}.${v.minor + 1}.0`) }];
  return [{ op, version: v }];
}

export function parseRange(text) {
  return String(text)
    .trim()
    .split('||')
    .map((set) => set.trim().replace(/([<>=~^]+)\s+/g, '$1').split(/\s+/).flatMap(comparatorsFor));
}

function passes(comparator, v) {
  const order = compare(v, comparator.version);
  if (comparator.op === '=') return order === 0;
  if (comparator.op === '>') return order > 0;
  if (comparator.op === '>=') return order >= 0;
  if (comparator.op === '<') return order < 0;
  return order <= 0;
}

export function satisfies(text, range) {
  const sets = parseRange(range);
  const v = parse(text);
  if (!v) return false;
  return sets.some((set) => set.every((comparator) => passes(comparator, v)));
}

// The highest version in the list that satisfies the range, or null.
export function maxSatisfying(versions, range) {
  const matching = [...versions].sort().filter((version) => satisfies(version, range));
  return matching.length ? matching[matching.length - 1] : null;
}
