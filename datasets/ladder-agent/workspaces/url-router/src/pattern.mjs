import { knownType } from './constraints.mjs';
import { PatternError } from './errors.mjs';

// A pattern is '/' or '/' plus segments joined by '/'. A segment is
//   users      static text
//   :id        a parameter; ':id<int>' limits its type; ':id?' (last segment only) may be absent
//   *          any one segment, not captured
//   **         one or more segments (last segment only), captured as params['**']
export function parsePattern(pattern) {
  if (typeof pattern !== 'string' || !pattern.startsWith('/')) throw new PatternError('a pattern starts with /');
  const parts = pattern === '/' ? [] : pattern.slice(1).split('/');
  const names = new Set();
  return parts.map((part, index) => {
    const last = index === parts.length - 1;
    if (part === '') throw new PatternError('a pattern has no empty segment');
    if (part === '*') return { kind: 'any' };
    if (part === '**') {
      if (!last) throw new PatternError('** must be the last segment');
      return { kind: 'rest' };
    }
    if (part.startsWith(':')) {
      const match = /^:([A-Za-z_][A-Za-z0-9_]*)(?:<([a-z]+)>)?(\?)?$/.exec(part);
      if (!match) throw new PatternError(`bad parameter ${part}`);
      const [, name, type = null, optional] = match;
      if (type && !knownType(type)) throw new PatternError(`unknown parameter type ${type}`);
      names.add(name);
      return { kind: 'param', name, type, optional: Boolean(optional) };
    }
    return { kind: 'static', value: part };
  });
}

// The segment lists a pattern stands for: an optional last parameter counts as absent and as present.
export function variantsOf(segments) {
  const last = segments.at(-1);
  if (last?.kind === 'param' && last.optional) return [segments.slice(0, -1), segments];
  return [segments];
}

// Two routes with the same shape are the same route, whatever their parameters are called.
export function shapeOf(segments) {
  return segments
    .map((seg) => (seg.kind === 'static' ? `s:${seg.value}` : seg.kind === 'param' ? `p:${seg.name}:${seg.type ?? ''}` : seg.kind))
    .join('/');
}
