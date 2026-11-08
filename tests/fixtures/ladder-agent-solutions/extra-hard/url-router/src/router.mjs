import { PatternError } from './errors.mjs';
import { decodeSegment } from './decode.mjs';
import { joinPatterns } from './mount.mjs';
import { allowList, chooseRoute } from './methods.mjs';
import { splitTarget } from './normalize.mjs';
import { parsePattern, shapeOf, variantsOf } from './pattern.mjs';
import { parseQuery } from './query.mjs';
import { createTrie } from './trie.mjs';
import { redirectTo, trailingAction } from './trailing.mjs';

// createRouter({ trailingSlash: 'ignore' | 'strict' | 'redirect', caseSensitive: true })
//   add(method, pattern, handler)   routes(): [{ method, pattern, handler }]   mount(prefix, router)
//   match(method, target) -> { status: 200, route, handler, params, query }
//                          | { status: 204, allow }          OPTIONS nobody handles
//                          | { status: 308, location }       trailing slash, policy 'redirect'
//                          | { status: 400 }                 a broken percent escape in the path
//                          | { status: 404 } | { status: 405, allow }
export function createRouter({ trailingSlash = 'ignore', caseSensitive = true } = {}) {
  const trie = createTrie({ caseSensitive });
  const list = [];
  const shapes = new Set();

  function add(method, pattern, handler) {
    if (typeof method !== 'string' || !/^[A-Za-z]+$/.test(method)) throw new TypeError('method must be a word');
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    const name = method.toUpperCase();
    const segments = parsePattern(pattern);
    const variants = variantsOf(segments);
    for (const variant of variants) {
      if (shapes.has(`${name} ${shapeOf(variant)}`)) throw new PatternError(`${name} ${pattern} is already taken`);
    }
    for (const variant of variants) {
      shapes.add(`${name} ${shapeOf(variant)}`);
      trie.insert(variant, { method: name, pattern, handler, segments: variant });
    }
    list.push({ method: name, pattern, handler });
  }

  function resolve(method, segments, query) {
    const found = trie.matches(segments);
    if (!found.length) return { status: 404 };
    const chosen = chooseRoute(found, method);
    if (!chosen) {
      const allow = allowList(found);
      return method === 'OPTIONS' ? { status: 204, allow } : { status: 405, allow };
    }
    const { route } = chosen;
    const params = Object.create(null);
    route.segments.forEach((seg, index) => {
      if (seg.kind === 'param') params[seg.name] = segments[index];
      else if (seg.kind === 'rest') params['**'] = segments.slice(index).join('/');
    });
    return { status: 200, route: route.pattern, handler: route.handler, params, query };
  }

  return {
    add,
    routes: () => list.map((item) => ({ ...item })),
    mount(prefix, sub) {
      for (const item of sub.routes()) add(item.method, joinPatterns(prefix, item.pattern), item.handler);
    },
    match(method, target) {
      const { segments: encoded, trailingSlash: hasSlash, query: rawQuery } = splitTarget(target);
      let segments;
      try {
        segments = encoded.map(decodeSegment);
      } catch {
        return { status: 400 };
      }
      const query = parseQuery(rawQuery);
      const verb = String(method).toUpperCase();
      const action = trailingAction(trailingSlash, hasSlash);
      if (action === 'reject') return { status: 404 };
      const result = resolve(verb, segments, query);
      if (action === 'redirect' && result.status === 200) return { status: 308, location: redirectTo(encoded, rawQuery) };
      return result;
    },
  };
}
