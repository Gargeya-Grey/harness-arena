// Hidden probes for ladder-agent-url-router; expected.json holds the answers.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return error.constructor.name;
  }
};
const h = (label) => () => label;
const view = (r) => {
  const out = { status: r.status };
  if (r.route !== undefined) out.route = r.route;
  if (r.params) out.params = { ...r.params };
  if (r.allow) out.allow = r.allow;
  if (r.location !== undefined) out.location = r.location;
  return out;
};
// A router with GET routes for the patterns. Gives the matched pattern, or the status.
const build = async (load, patterns, options, method = 'GET') => {
  const { createRouter } = await lib(load);
  const router = createRouter(options);
  for (const pattern of patterns) router.add(method, pattern, h(pattern));
  return router;
};
const pick = (router, targets, method = 'GET') =>
  targets.map((target) => {
    const r = attempt(() => router.match(method, target));
    return typeof r === 'string' ? r : r.status === 200 ? r.route : r.status;
  });

export const probes = [
  {
    name: 'keeps static, parameter, any and rest routes matching',
    run: async ({ load }) => {
      const router = await build(load, ['/', '/a', '/a/:x', '/b/*/c', '/d/**']);
      return [...pick(router, ['/', '/a', '/a/1', '/b/q/c', '/d/1/2']), ...['/a/1', '/d/1/2'].map((t) => view(router.match('GET', t)).params)];
    },
  },
  {
    name: 'a static segment beats a parameter, that beats any, that beats rest, whatever the order of registration',
    run: async ({ load }) => {
      const router = await build(load, ['/f/**', '/f/*', '/f/:x', '/f/a']);
      const second = await build(load, ['/g/**', '/g/*']);
      return [...pick(router, ['/f/a', '/f/b', '/f/b/c']), ...pick(second, ['/g/b', '/g/b/c'])];
    },
  },
  {
    name: 'the leftmost segment decides, and a branch that fails falls back to a looser route',
    run: async ({ load }) => {
      const router = await build(load, ['/a/b/c', '/a/:x/d', '/*/b/d', '/a/:x/c', '/a/b/:y']);
      return pick(router, ['/a/b/c', '/a/b/d', '/z/b/d', '/a/q/c', '/a/c/e', '/a/b/zz']);
    },
  },
  {
    name: 'a typed parameter beats a plain one, and int means digits only',
    run: async ({ load }) => {
      const router = await build(load, ['/n/:id', '/n/:id<int>']);
      const typed = await build(load, ['/s/:v<slug>', '/s/:v<int>']);
      return [...pick(router, ['/n/12', '/n/-5', '/n/+5', '/n/1a', '/n/007']), ...pick(typed, ['/s/123', '/s/abc', '/s/Abc', '/s/a--b', '/s/a-b-1', '/s/-a'])];
    },
  },
  {
    name: 'an optional parameter is missing from the params when it is not given, and a static sibling wins',
    run: async ({ load }) => {
      const router = await build(load, ['/u/:id?', '/u/list']);
      return ['/u', '/u/5', '/u/', '/u/list'].map((t) => view(router.match('GET', t)));
    },
  },
  {
    name: 'a rest segment needs at least one segment and gives them decoded and joined',
    run: async ({ load }) => {
      const router = await build(load, ['/files/**']);
      return ['/files', '/files/', '/files/a', '/files/a/b%20c/d', '/files/a%2Fb/c'].map((t) => view(router.match('GET', t)));
    },
  },
  {
    name: 'an encoded slash stays inside its segment, and a percent sign is decoded once',
    run: async ({ load }) => {
      const router = await build(load, ['/tag/:name', '/pair/:a/:b']);
      return ['/tag/a%2Fb', '/tag/a%2Fb/x', '/tag/100%2541', '/tag/%E2%82%AC5', '/pair/a%2Fb/c', '/tag/a%252Fb'].map((t) => view(router.match('GET', t)));
    },
  },
  {
    name: 'a plus sign in the path is a plus sign',
    run: async ({ load }) => {
      const router = await build(load, ['/tag/:name']);
      return ['/tag/a+b', '/tag/a%2Bb', '/tag/a%20b'].map((t) => view(router.match('GET', t)).params);
    },
  },
  {
    name: 'dot segments are resolved and cannot climb above the root',
    run: async ({ load }) => {
      const router = await build(load, ['/x/y', '/']);
      return pick(router, ['/x/./y', '/x/z/../y', '/../x/y', '/x/../../x/y', '/x/y/./', '/..', '/x/../..']);
    },
  },
  {
    name: 'a broken percent escape in the path is status 400',
    run: async ({ load }) => {
      const router = await build(load, ['/tag/:name']);
      return ['/tag/%zz', '/tag/%E0%A4%A', '/nope/%', '/tag/ok?x=%zz', '/tag/%zz?x=1'].map((t) => {
        const r = attempt(() => router.match('GET', t));
        return typeof r === 'string' ? r : [r.status, r.query ? { ...r.query } : null];
      });
    },
  },
  {
    name: 'query strings: repeated keys, plus, equal signs, odd pairs and keys like __proto__',
    run: async ({ load }) => {
      const { parseQuery, createRouter } = await lib(load);
      const router = createRouter();
      router.add('GET', '/s', h('s'));
      const raw = 'a=1&a=2&a=3&b=x+y&c=1=2&d&&e=&f=%20&g=%zz&__proto__=p&h%20i=j';
      const parsed = parseQuery(raw);
      return {
        parsed: { ...parsed },
        keys: Object.keys(parsed),
        proto: Object.getPrototypeOf(parsed) === null || Object.getPrototypeOf(parsed) === Object.prototype,
        viaMatch: { ...router.match('GET', `/s?${raw}#frag`).query },
        pair: { ...parseQuery('a=1&a') },
        empty: [{ ...parseQuery('') }, { ...parseQuery('&&') }, { ...parseQuery('=x') }],
      };
    },
  },
  {
    name: 'keeps a strict trailing slash policy',
    run: async ({ load }) => {
      const router = await build(load, ['/', '/a', '/a/b'], { trailingSlash: 'strict' });
      return pick(router, ['/', '/a', '/a/', '/a/b', '/a/b/', '/a//', '//']);
    },
  },
  {
    name: 'the redirect policy keeps the query and redirects only a path that exists',
    run: async ({ load }) => {
      const { createRouter } = await lib(load);
      const router = createRouter({ trailingSlash: 'redirect' });
      router.add('GET', '/a', h('a'));
      router.add('GET', '/x y', h('xy'));
      router.add('GET', '/', h('root'));
      return [
        ['GET', '/a/'],
        ['GET', '/a/?x=1&y=%20'],
        ['GET', '/a'],
        ['GET', '/nope/'],
        ['POST', '/a/'],
        ['GET', '/x%20y/'],
        ['GET', '/'],
        ['GET', '/b/../a/'],
        ['GET', '/%zz/'],
      ].map(([method, target]) => view(router.match(method, target)));
    },
  },
  {
    name: 'a method falls back to a looser route that has it, and 405 lists every allowed method sorted',
    run: async ({ load }) => {
      const { createRouter } = await lib(load);
      const router = createRouter();
      router.add('POST', '/users/me', h('post-me'));
      router.add('GET', '/users/:id', h('get-id'));
      router.add('DELETE', '/users/*', h('delete-any'));
      return [['GET', '/users/me'], ['POST', '/users/me'], ['DELETE', '/users/me'], ['PUT', '/users/me'], ['PUT', '/users/5'], ['GET', '/nope']].map(([m, t]) => view(router.match(m, t)));
    },
  },
  {
    name: 'HEAD uses the GET route unless a route has its own HEAD, and OPTIONS answers 204 with the allowed methods',
    run: async ({ load }) => {
      const { createRouter } = await lib(load);
      const router = createRouter();
      router.add('GET', '/p', h('get-p'));
      router.add('GET', '/q', h('get-q'));
      router.add('HEAD', '/q', h('head-q'));
      router.add('POST', '/r', h('post-r'));
      router.add('OPTIONS', '/o', h('options-o'));
      router.add('GET', '/o', h('get-o'));
      return [['HEAD', '/p'], ['HEAD', '/q'], ['HEAD', '/r'], ['OPTIONS', '/p'], ['OPTIONS', '/q'], ['OPTIONS', '/r'], ['OPTIONS', '/o'], ['OPTIONS', '/none'], ['head', '/p']].map(([m, t]) => view(router.match(m, t)));
    },
  },
  {
    name: 'a method is case-insensitive when a route is added and when it is matched',
    run: async ({ load }) => {
      const { createRouter } = await lib(load);
      const router = createRouter();
      router.add('get', '/x', h('x'));
      router.add('Post', '/x', h('y'));
      return { listed: router.routes().map((r) => r.method), results: [['GET', '/x'], ['get', '/x'], ['POST', '/x'], ['post', '/x'], ['delete', '/x']].map(([m, t]) => view(router.match(m, t))), twice: attempt(() => router.add('GET', '/x', h('z'))) };
    },
  },
  {
    name: 'two routes of the same shape are refused, whatever their parameters are called',
    run: async ({ load }) => {
      const { createRouter } = await lib(load);
      const tryAdd = (pairs) => {
        const router = createRouter();
        return pairs.map(([method, pattern]) => attempt(() => router.add(method, pattern, h(pattern))) ?? 'ok');
      };
      return [
        tryAdd([['GET', '/u/:id'], ['GET', '/u/:name']]),
        tryAdd([['GET', '/u/:id'], ['POST', '/u/:name']]),
        tryAdd([['GET', '/u/:id<int>'], ['GET', '/u/:id']]),
        tryAdd([['GET', '/a/:id?'], ['GET', '/a']]),
        tryAdd([['GET', '/a/:id?'], ['GET', '/a/:other']]),
        tryAdd([['GET', '/a/:id<int>?'], ['GET', '/a/:id']]),
        tryAdd([['GET', '/a/*'], ['GET', '/a/:x']]),
        tryAdd([['GET', '/a/b'], ['get', '/a/b']]),
      ];
    },
  },
  {
    name: 'a parameter name is used once, and an optional parameter comes last',
    run: async ({ load }) => {
      const { createRouter } = await lib(load);
      const router = createRouter();
      return ['/a/:id/b/:id', '/a/:id?/b', '/a/:x?/:y', '/a/:x/:y', '/a/:x/**', '/a/:x?'].map((pattern) => attempt(() => router.add('GET', pattern, h(pattern))) ?? 'ok');
    },
  },
  {
    name: 'keeps bad patterns refused',
    run: async ({ load }) => {
      const { createRouter } = await lib(load);
      const router = createRouter();
      return ['users', '/a//b', '/a/**/b', '/a/:', '/a/:1x', '/a/:x<nope>', '/a/', ''].map((pattern) => attempt(() => router.add('GET', pattern, h('x'))));
    },
  },
  {
    name: 'a mounted router keeps its root route, its parameters and the parameters of the prefix',
    run: async ({ load }) => {
      const { createRouter } = await lib(load);
      const make = (...patterns) => {
        const router = createRouter();
        for (const pattern of patterns) router.add('GET', pattern, h(pattern));
        return router;
      };
      const root = createRouter();
      root.mount('/api', make('/', '/ping', '/items/:id'));
      root.mount('/', make('/', '/home'));
      root.mount('/t/:tenant/', make('/', '/stats'));
      const taken = attempt(() => root.mount('/api', make('/ping')));
      return { views: ['/api', '/api/', '/api/ping', '/api/items/9', '/', '/home', '/t/acme', '/t/acme/stats'].map((t) => view(root.match('GET', t))), routes: root.routes().map((r) => r.pattern), taken };
    },
  },
  {
    name: 'case-insensitive routing keeps the case of the parameters',
    run: async ({ load }) => {
      const insensitive = await build(load, ['/Members/:id', '/Docs/Readme'], { caseSensitive: false });
      const sensitive = await build(load, ['/Members/:id']);
      return { insensitive: ['/members/AbC', '/MEMBERS/x', '/docs/README', '/Members/Q'].map((t) => view(insensitive.match('GET', t))), sensitive: pick(sensitive, ['/members/x', '/Members/x']) };
    },
  },
  {
    name: 'keeps an any segment to exactly one segment',
    run: async ({ load }) => {
      const router = await build(load, ['/w/*/z']);
      return pick(router, ['/w/a/z', '/w/a/b/z', '/w/z', '/w//z']);
    },
  },
];
