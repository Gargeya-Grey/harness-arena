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
export function resourceMatches(pattern, userId, segments, exact) {
  const text = '/' + pattern.map((seg) => (seg.kind === 'text' ? seg.value : seg.kind === 'user' ? userId : seg.kind === 'one' ? '*' : '**')).join('/');
  const source = text
    .replace(/[.+?^$()|[\]{}\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replaceAll('\u0000', '.*');
  return new RegExp('^' + source + (exact ? '$' : '')).test('/' + segments.join('/'));
}
