import { PolicyError } from './errors.mjs';

// '/a//b/' -> ['a', 'b']. Dot segments are refused, they would let a path leave its folder.
export function normalizeResource(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new PolicyError('a resource starts with /');
  const out = [];
  for (const part of path.split('/')) {
    if (part === '') continue;
    if (part === '.' || part === '..') throw new PolicyError('a resource has no dot segments');
    out.push(part);
  }
  return out;
}

const VARIABLE = '${user.id}';

// Segments of a pattern: text, '*' (one segment), '**' (zero or more segments), or exactly ${user.id}.
export function compilePattern(pattern) {
  return normalizeResource(pattern).map((part) => {
    if (part === '*') return { kind: 'one' };
    if (part === '**') return { kind: 'many' };
    if (part === VARIABLE) return { kind: 'user' };
    if (part.includes('${')) throw new PolicyError('a variable must be a whole segment');
    return { kind: 'text', value: part };
  });
}

// Does the pattern cover the resource? Unless `exact`, it covers everything below it too.
// The user id is one literal segment, whatever characters it has.
export function resourceMatches(pattern, userId, segments, exact) {
  const walk = (p, s) => {
    if (p === pattern.length) return exact ? s === segments.length : true;
    const seg = pattern[p];
    if (seg.kind === 'many') {
      for (let skip = s; skip <= segments.length; skip += 1) if (walk(p + 1, skip)) return true;
      return false;
    }
    if (s >= segments.length) return false;
    if (seg.kind === 'one') return walk(p + 1, s + 1);
    const want = seg.kind === 'user' ? userId : seg.value;
    return segments[s] === want && walk(p + 1, s + 1);
  };
  return walk(0, 0);
}
