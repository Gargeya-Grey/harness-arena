import { checkConstraint, typeRank } from './constraints.mjs';

const node = () => ({ statics: new Map(), params: [], any: null, rest: new Map(), routes: new Map() });

// A route is { method, pattern, handler, segments }. The trie keeps one node per
// pattern position; routes sit at the node where their pattern ends.
export function createTrie({ caseSensitive = true } = {}) {
  const root = node();
  const fold = caseSensitive ? (text) => text : (text) => text.toLowerCase();

  function insert(segments, route) {
    let at = root;
    segments.forEach((seg, index) => {
      if (seg.kind === 'rest') return;
      if (seg.kind === 'static') {
        const key = fold(seg.value);
        if (!at.statics.has(key)) at.statics.set(key, node());
        at = at.statics.get(key);
      } else if (seg.kind === 'param') {
        let entry = at.params.find((item) => item.type === seg.type);
        if (!entry) {
          entry = { type: seg.type, node: node() };
          at.params.push(entry);
          at.params.sort((a, b) => typeRank(a.type) - typeRank(b.type));
        }
        at = entry.node;
      } else {
        at.any ??= node();
        at = at.any;
      }
    });
    const target = segments.at(-1)?.kind === 'rest' ? at.rest : at.routes;
    target.set(route.method, route);
  }

  // Every route set that fits the segments, most specific first: at each position a
  // static segment beats a typed parameter, that beats a plain parameter, that beats
  // '*', and '**' comes last. The leftmost position decides.
  function matches(segments) {
    const out = [];
    const walk = (at, index) => {
      if (index === segments.length) {
        if (at.routes.size) out.push(at.routes);
        return;
      }
      const value = segments[index];
      const next = at.statics.get(fold(value));
      if (next) walk(next, index + 1);
      for (const entry of at.params) if (checkConstraint(entry.type, value)) walk(entry.node, index + 1);
      if (at.any) walk(at.any, index + 1);
      if (at.rest.size) out.push(at.rest);
    };
    walk(root, 0);
    return out;
  }

  return { insert, matches };
}
