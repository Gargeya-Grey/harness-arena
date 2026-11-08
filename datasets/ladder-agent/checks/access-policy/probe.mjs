// Hidden probes for ladder-agent-access-policy; expected.json holds the answers.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return error.constructor.name;
  }
};
const allow = (id, roles, actions, resources, extra = {}) => ({ id, effect: 'allow', roles, actions, resources, ...extra });
const deny = (id, roles, actions, resources, extra = {}) => ({ id, effect: 'deny', roles, actions, resources, ...extra });
const ok = (value) => value ?? 'ok';

// A policy with roles viewer < editor < admin, and some users.
const make = async (load, statements = [], clockStart = 0) => {
  const { createPolicy, manualClock } = await lib(load);
  const clock = manualClock(clockStart);
  const policy = createPolicy({ clock });
  policy.defineRole('viewer');
  policy.defineRole('editor', { parents: ['viewer'] });
  policy.defineRole('admin', { parents: ['editor'] });
  policy.defineRole('auditor');
  policy.setUser('ann', { roles: ['editor'], attrs: { dept: 'ops', level: 3 } });
  policy.setUser('bob', { roles: ['viewer'] });
  policy.setUser('cy', { roles: ['admin'], attrs: { dept: 'dev' } });
  policy.setUser('dee', { roles: ['auditor'], attrs: { dept: 'ops' } });
  for (const statement of statements) policy.addStatement(statement);
  return { policy, clock };
};
const checks = (policy, user, requests) => requests.map(([action, resource, context]) => policy.check(user, action, resource, context));

export const probes = [
  {
    name: 'keeps nothing allowed by default, an allow, and the shape of explain',
    run: async ({ load }) => {
      const { policy } = await make(load, [allow('read', ['viewer'], ['doc:read'], ['/docs'])]);
      return [policy.explain('bob', 'doc:read', '/docs/1'), policy.explain('bob', 'doc:write', '/docs/1'), policy.explain('dee', 'doc:read', '/docs/1'), policy.check('ann', 'doc:read', '/docs')];
    },
  },
  {
    name: 'any deny beats every allow, in whatever order the statements were added',
    run: async ({ load }) => {
      const a = await make(load, [allow('yes', ['viewer'], ['doc:*'], ['/docs']), deny('no', ['viewer'], ['doc:write'], ['/docs/x'])]);
      const b = await make(load, [deny('no', ['viewer'], ['doc:write'], ['/docs/x']), allow('yes', ['viewer'], ['doc:*'], ['/docs'])]);
      const c = await make(load, [deny('no', ['editor'], ['doc:write'], ['/docs/x']), allow('yes', ['viewer'], ['doc:*'], ['/docs/x/deep'])]);
      const ask = (p, user) => [p.explain(user, 'doc:write', '/docs/x/deep'), p.explain(user, 'doc:read', '/docs/x/deep')];
      return [ask(a.policy, 'bob'), ask(b.policy, 'bob'), ask(c.policy, 'ann'), ask(c.policy, 'bob')];
    },
  },
  {
    name: 'explain names every statement of the winning effect, sorted by id',
    run: async ({ load }) => {
      const { policy } = await make(load, [
        allow('b', ['viewer'], ['doc:read'], ['/d']),
        allow('c', ['editor'], ['doc:*'], ['/d']),
        allow('a', ['*'], ['*'], ['/']),
        allow('other', ['viewer'], ['doc:write'], ['/d']),
        deny('z', ['viewer'], ['doc:read'], ['/d/x']),
        deny('m', ['editor'], ['doc:read'], ['/d/x']),
        deny('skip', ['admin'], ['doc:read'], ['/d/x']),
      ]);
      return [policy.explain('ann', 'doc:read', '/d/1'), policy.explain('ann', 'doc:read', '/d/x'), policy.explain('bob', 'doc:read', '/d/x'), policy.explain('cy', 'doc:read', '/d/x'), policy.explain('bob', 'doc:write', '/d')];
    },
  },
  {
    name: 'keeps a role inheriting through any number of parents, denies included',
    run: async ({ load }) => {
      const { policy } = await make(load, []);
      policy.defineRole('r1');
      policy.defineRole('r2', { parents: ['r1'] });
      policy.defineRole('r3', { parents: ['r2'] });
      policy.defineRole('r4', { parents: ['r3', 'viewer'] });
      policy.defineRole('left', { parents: ['r1'] });
      policy.defineRole('right', { parents: ['r1'] });
      policy.defineRole('tip', { parents: ['left', 'right'] });
      policy.addStatement(allow('a1', ['r1'], ['doc:read'], ['/x']));
      policy.addStatement(deny('d2', ['r2'], ['doc:read'], ['/x/secret']));
      policy.addStatement(allow('av', ['viewer'], ['doc:list'], ['/x']));
      for (const [id, roles] of [['u1', ['r1']], ['u3', ['r3']], ['u4', ['r4']], ['u5', ['tip']], ['u6', ['admin']]]) policy.setUser(id, { roles });
      const ask = (user) => [policy.check(user, 'doc:read', '/x/open'), policy.check(user, 'doc:read', '/x/secret/1'), policy.check(user, 'doc:list', '/x')];
      return { u1: ask('u1'), u3: ask('u3'), u4: ask('u4'), u5: ask('u5'), u6: ask('u6'), roles: [policy.effectiveRoles('u4'), policy.effectiveRoles('u5'), policy.effectiveRoles('nobody')] };
    },
  },
  {
    name: 'a role cannot inherit from itself, directly or through other roles, and a refused role changes nothing',
    run: async ({ load }) => {
      const { policy } = await make(load, [allow('x', ['viewer'], ['doc:read'], ['/a'])]);
      policy.defineRole('p');
      policy.defineRole('q', { parents: ['p'] });
      policy.defineRole('s', { parents: ['q'] });
      const out = {
        direct: attempt(() => policy.defineRole('p', { parents: ['p'] })),
        fresh: attempt(() => policy.defineRole('n', { parents: ['n'] })),
        indirect: attempt(() => policy.defineRole('p', { parents: ['s'] })),
        middle: attempt(() => policy.defineRole('q', { parents: ['s'] })),
        unknown: attempt(() => policy.defineRole('t', { parents: ['nope'] })),
        star: attempt(() => policy.defineRole('*')),
        empty: attempt(() => policy.defineRole('')),
      };
      policy.setUser('w', { roles: ['s'] });
      out.rolesAfter = policy.effectiveRoles('w');
      out.redefine = ok(attempt(() => policy.defineRole('q', { parents: [] })));
      out.rolesRedefined = policy.effectiveRoles('w');
      out.unknownStillMissing = attempt(() => policy.setUser('z', { roles: ['n'] }));
      return out;
    },
  },
  {
    name: 'a change of a role or a group reaches the users at once',
    run: async ({ load }) => {
      const { policy } = await make(load, [allow('s1', ['viewer'], ['doc:read'], ['/a']), allow('s2', ['auditor'], ['doc:read'], ['/b'])]);
      policy.defineRole('plain');
      policy.defineGroup('g', ['plain']);
      policy.setUser('eve', { roles: ['plain'], groups: ['g'] });
      const first = [policy.check('eve', 'doc:read', '/a'), policy.check('eve', 'doc:read', '/b')];
      policy.defineRole('plain', { parents: ['viewer'] });
      const second = [policy.check('eve', 'doc:read', '/a'), policy.check('eve', 'doc:read', '/b'), policy.effectiveRoles('eve')];
      policy.defineGroup('g', ['auditor']);
      const third = [policy.check('eve', 'doc:read', '/b'), policy.effectiveRoles('eve')];
      policy.setUser('eve', { roles: [] });
      return { first, second, third, fourth: policy.effectiveRoles('eve') };
    },
  },
  {
    name: 'direct roles and group roles add up, and unknown roles and groups are refused',
    run: async ({ load }) => {
      const { policy } = await make(load, [allow('s', ['auditor'], ['doc:read'], ['/a']), allow('t', ['viewer'], ['doc:list'], ['/a'])]);
      policy.defineGroup('audit', ['auditor', 'auditor']);
      policy.defineGroup('empty', []);
      policy.setUser('fay', { roles: ['viewer'], groups: ['audit'] });
      policy.setUser('gus', { groups: ['audit', 'empty'] });
      return {
        fay: [policy.effectiveRoles('fay'), policy.check('fay', 'doc:read', '/a'), policy.check('fay', 'doc:list', '/a')],
        gus: [policy.effectiveRoles('gus'), policy.check('gus', 'doc:read', '/a'), policy.check('gus', 'doc:list', '/a')],
        badGroup: attempt(() => policy.defineGroup('g2', ['nope'])),
        badUserRole: attempt(() => policy.setUser('h', { roles: ['nope'] })),
        badUserGroup: attempt(() => policy.setUser('h', { groups: ['nope'] })),
        badId: attempt(() => policy.setUser('', {})),
      };
    },
  },
  {
    name: 'a statement covers its folder and everything below, on whole segments only',
    run: async ({ load }) => {
      const { policy } = await make(load, [allow('s', ['viewer'], ['doc:read'], ['/projects/42', '/other/1'])]);
      return checks(policy, 'bob', [
        ['doc:read', '/projects/42'],
        ['doc:read', '/projects/42/docs/7'],
        ['doc:read', '/projects/4'],
        ['doc:read', '/projects/420'],
        ['doc:read', '/projects/42x/a'],
        ['doc:read', '/projects'],
        ['doc:read', '/'],
        ['doc:read', '/other/1/a'],
        ['doc:read', '/other/10'],
      ]);
    },
  },
  {
    name: 'keeps exact covering only the resource itself, with slashes normalized',
    run: async ({ load }) => {
      const { policy } = await make(load, [allow('s', ['viewer'], ['doc:read'], ['/a/b/'], { exact: true }), allow('root', ['auditor'], ['doc:read'], ['/'])]);
      return {
        exact: checks(policy, 'bob', [['doc:read', '/a/b'], ['doc:read', '/a/b/'], ['doc:read', '//a///b'], ['doc:read', '/a/b/c'], ['doc:read', '/a']]),
        root: checks(policy, 'dee', [['doc:read', '/'], ['doc:read', '/anything/at/all'], ['doc:read', '//']]),
      };
    },
  },
  {
    name: 'one star is one segment, two stars are zero or more segments',
    run: async ({ load }) => {
      const { policy } = await make(load, [
        allow('one', ['viewer'], ['doc:read'], ['/p/*/docs'], { exact: true }),
        allow('many', ['editor'], ['doc:write'], ['/q/**/end'], { exact: true }),
        allow('tail', ['admin'], ['doc:delete'], ['/r/**']),
        allow('mid', ['auditor'], ['doc:read'], ['/**/secret/*'], { exact: true }),
      ]);
      return {
        one: checks(policy, 'bob', [['doc:read', '/p/1/docs'], ['doc:read', '/p/docs'], ['doc:read', '/p/1/2/docs'], ['doc:read', '/p/1/docs/x']]),
        many: checks(policy, 'ann', [['doc:write', '/q/end'], ['doc:write', '/q/a/end'], ['doc:write', '/q/a/b/c/end'], ['doc:write', '/q/a'], ['doc:write', '/q/end/x']]),
        tail: checks(policy, 'cy', [['doc:delete', '/r'], ['doc:delete', '/r/a/b'], ['doc:delete', '/s']]),
        mid: checks(policy, 'dee', [['doc:read', '/secret/x'], ['doc:read', '/a/b/secret/x'], ['doc:read', '/a/secret'], ['doc:read', '/a/secret/x/y']]),
      };
    },
  },
  {
    name: 'keeps resources absolute and free of dot segments, in a request and in a pattern',
    run: async ({ load }) => {
      const { policy } = await make(load, [allow('s', ['viewer'], ['doc:read'], ['/a'])]);
      const bad = ['a', '', '/a/../b', '/a/./b', '/..', 'http://x/a', null, 5];
      return {
        requests: bad.map((resource) => attempt(() => policy.check('bob', 'doc:read', resource))),
        patterns: ['a/b', '/a/../b', '/a/./b', '', '/a/x${user.id}', '/a/${user.id}y'].map((pattern, index) => attempt(() => policy.addStatement(allow(`p${index}`, ['viewer'], ['doc:read'], [pattern]))) ?? 'ok'),
        dotsInNames: policy.check('bob', 'doc:read', '/a/..b/.c/d.'),
      };
    },
  },
  {
    name: 'the user variable is one literal segment and never widens a pattern',
    run: async ({ load }) => {
      const { policy } = await make(load, [allow('home', ['*'], ['doc:*'], ['/homes/${user.id}/**'])]);
      for (const id of ['*', '**', 'a/b', '.', 'x.y', 'a b', 'a+b']) policy.setUser(id, { roles: ['viewer'] });
      const ask = (user, resource) => policy.check(user, 'doc:read', resource);
      return {
        ann: [ask('ann', '/homes/ann'), ask('ann', '/homes/ann/x/y'), ask('ann', '/homes/bob'), ask('ann', '/homes/anna'), ask('ann', '/homes')],
        star: [ask('*', '/homes/bob'), ask('*', '/homes/*'), ask('*', '/homes/*/x')],
        starStar: [ask('**', '/homes/bob/x'), ask('**', '/homes/**/x')],
        slash: [ask('a/b', '/homes/a/b'), ask('a/b', '/homes/a'), ask('a/b', '/homes/a/b/c')],
        dot: [ask('.', '/homes/zzz'), ask('x.y', '/homes/xzy'), ask('x.y', '/homes/x.y/f'), ask('a b', '/homes/a b'), ask('a+b', '/homes/a+b'), ask('a+b', '/homes/aab')],
      };
    },
  },
  {
    name: 'actions match by exact name, by namespace or by star, and notActions covers all the others',
    run: async ({ load }) => {
      const { policy } = await make(load, [
        allow('ns', ['viewer'], ['doc:*'], ['/n']),
        allow('exact', ['viewer'], ['user:read'], ['/e']),
        allow('all', ['auditor'], ['*'], ['/all']),
        allow('all2', ['admin'], ['*'], ['/all']),
        deny('only-read', ['editor'], [], ['/ro'], { actions: undefined, notActions: ['doc:read', 'doc:list'] }),
        allow('base', ['editor'], ['doc:*'], ['/ro']),
      ]);
      return {
        ns: checks(policy, 'bob', [['doc:read', '/n'], ['doc:x.y', '/n'], ['docs:read', '/n'], ['user:read', '/n'], ['doc:', '/n']].slice(0, 4)),
        exact: checks(policy, 'bob', [['user:read', '/e'], ['user:write', '/e'], ['users:read', '/e'], ['user:reader', '/e']]),
        all: checks(policy, 'dee', [['any:thing', '/all'], ['doc:read', '/all/x']]),
        notActions: checks(policy, 'ann', [['doc:read', '/ro'], ['doc:list', '/ro'], ['doc:write', '/ro'], ['user:read', '/ro']]),
        viewer: checks(policy, 'bob', [['doc:write', '/ro']]),
      };
    },
  },
  {
    name: 'keeps bad actions, bad action patterns and statements with both kinds of actions refused',
    run: async ({ load }) => {
      const { policy } = await make(load, []);
      const statement = (extra) => ({ id: 's', effect: 'allow', roles: ['viewer'], resources: ['/a'], ...extra });
      return {
        requests: ['read', 'Doc:read', 'doc:', ':read', 'doc:*', '*', 5, null].map((action) => attempt(() => policy.check('bob', action, '/a'))),
        patterns: ['read', 'doc:re*', '**', 'Doc:*', ''].map((pattern) => attempt(() => policy.addStatement(statement({ actions: [pattern] })))),
        both: attempt(() => policy.addStatement(statement({ actions: ['doc:read'], notActions: ['doc:write'] }))),
        none: attempt(() => policy.addStatement(statement({}))),
        empty: attempt(() => policy.addStatement(statement({ actions: [] }))),
      };
    },
  },
  {
    name: 'a condition that cannot be told for a missing attribute denies, and allows nothing',
    run: async ({ load }) => {
      const { policy } = await make(load, [
        allow('open', ['*'], ['doc:*'], ['/a']),
        deny('need-dept', ['*'], ['doc:write'], ['/a'], { conditions: { attrs: { dept: 'dev' } } }),
        deny('need-mfa', ['*'], ['doc:delete'], ['/a'], { conditions: { mfa: true } }),
        deny('need-owner', ['*'], ['doc:share'], ['/a'], { conditions: { owner: true } }),
      ]);
      const only = await make(load, [
        allow('owner-only', ['*'], ['doc:own'], ['/a'], { conditions: { owner: true } }),
        allow('mfa-only', ['*'], ['doc:secure'], ['/a'], { conditions: { mfa: true } }),
        allow('dept-only', ['*'], ['doc:dept'], ['/a'], { conditions: { attrs: { dept: 'ops' } } }),
      ]);
      const ask = (user, action, context) => policy.check(user, action, '/a', context);
      const askOnly = (user, action, context) => only.policy.check(user, action, '/a', context);
      return {
        denyDept: ['ann', 'bob', 'cy', 'dee'].map((user) => ask(user, 'doc:write')),
        denyMfa: [ask('ann', 'doc:delete'), ask('ann', 'doc:delete', {}), ask('ann', 'doc:delete', { mfa: false }), ask('ann', 'doc:delete', { mfa: true })],
        denyOwner: [ask('ann', 'doc:share'), ask('ann', 'doc:share', { owner: 'ann' }), ask('ann', 'doc:share', { owner: 'bob' })],
        allowOwner: [askOnly('ann', 'doc:own'), askOnly('ann', 'doc:own', { owner: 'ann' }), askOnly('ann', 'doc:own', { owner: 'bob' })],
        allowMfa: [askOnly('ann', 'doc:secure'), askOnly('ann', 'doc:secure', { mfa: true }), askOnly('ann', 'doc:secure', { mfa: false })],
        allowDept: ['ann', 'bob', 'cy'].map((user) => askOnly(user, 'doc:dept')),
      };
    },
  },
  {
    name: 'all conditions of a statement must hold, and one that fails settles it even when another cannot be told',
    run: async ({ load }) => {
      const { policy } = await make(load, [
        allow('open', ['*'], ['doc:*'], ['/a']),
        deny('combo', ['*'], ['doc:write'], ['/a'], { conditions: { attrs: { dept: 'dev' }, mfa: true } }),
        deny('combo2', ['*'], ['doc:delete'], ['/a'], { conditions: { attrs: { dept: 'ops', level: 3 }, owner: true } }),
      ]);
      const multi = await make(load, [allow('multi', ['*'], ['doc:own'], ['/a'], { conditions: { attrs: { dept: 'ops', level: 3 }, mfa: true } })]);
      const ask = (user, action, context) => policy.check(user, action, '/a', context);
      return {
        write: [ask('ann', 'doc:write'), ask('cy', 'doc:write'), ask('cy', 'doc:write', { mfa: false }), ask('cy', 'doc:write', { mfa: true }), ask('bob', 'doc:write')],
        remove: [ask('ann', 'doc:delete'), ask('ann', 'doc:delete', { owner: 'ann' }), ask('ann', 'doc:delete', { owner: 'x' }), ask('cy', 'doc:delete'), ask('bob', 'doc:delete')],
        own: [multi.policy.check('ann', 'doc:own', '/a', { mfa: true }), multi.policy.check('ann', 'doc:own', '/a'), multi.policy.check('ann', 'doc:own', '/a', { mfa: false }), multi.policy.check('dee', 'doc:own', '/a', { mfa: true })],
      };
    },
  },
  {
    name: 'between starts at from and ends before to',
    run: async ({ load }) => {
      const { policy, clock } = await make(load, [allow('window', ['*'], ['doc:read'], ['/a'], { conditions: { between: [100, 200] } }), deny('night', ['*'], ['doc:write'], ['/a'], { conditions: { between: [0, 50] } }), allow('open', ['*'], ['doc:write'], ['/a'])]);
      const out = {};
      for (const at of [0, 49, 50, 99, 100, 199, 200, 201]) {
        clock.set(at);
        out[at] = [policy.check('ann', 'doc:read', '/a'), policy.check('ann', 'doc:write', '/a')];
      }
      return out;
    },
  },
  {
    name: 'keeps attributes compared strictly',
    run: async ({ load }) => {
      const { policy } = await make(load, [
        allow('num', ['*'], ['doc:a'], ['/a'], { conditions: { attrs: { level: 3 } } }),
        allow('str', ['*'], ['doc:b'], ['/a'], { conditions: { attrs: { level: '3' } } }),
        allow('both', ['*'], ['doc:c'], ['/a'], { conditions: { attrs: { level: 3, dept: 'ops' } } }),
        allow('none', ['*'], ['doc:d'], ['/a'], { conditions: { attrs: {} } }),
      ]);
      return ['doc:a', 'doc:b', 'doc:c', 'doc:d'].map((action) => ['ann', 'bob', 'cy', 'dee'].map((user) => policy.check(user, action, '/a')));
    },
  },
  {
    name: 'keeps bad conditions and bad statements refused',
    run: async ({ load }) => {
      const { policy } = await make(load, []);
      const statement = (extra) => ({ id: 's', effect: 'allow', roles: ['viewer'], actions: ['doc:read'], resources: ['/a'], ...extra });
      const bad = [
        { conditions: { ip: '1.2.3.4' } },
        { conditions: { owner: false } },
        { conditions: { mfa: 'yes' } },
        { conditions: { between: [5, 5] } },
        { conditions: { between: [1] } },
        { conditions: { attrs: [] } },
        { conditions: [] },
        { effect: 'permit' },
        { id: '' },
        { roles: [] },
        { roles: ['nope'] },
        { resources: [] },
        { resources: undefined },
      ];
      return bad.map((extra) => attempt(() => policy.addStatement(statement(extra))));
    },
  },
  {
    name: 'a statement id is unique, and a removed statement stops counting at once',
    run: async ({ load }) => {
      const { policy } = await make(load, [allow('a', ['viewer'], ['doc:read'], ['/x']), deny('d', ['viewer'], ['doc:read'], ['/x/y'])]);
      const out = {
        duplicate: attempt(() => policy.addStatement(allow('a', ['viewer'], ['doc:write'], ['/x']))),
        before: [policy.explain('bob', 'doc:read', '/x/y'), policy.check('bob', 'doc:write', '/x')],
      };
      out.removeDeny = policy.removeStatement('d');
      out.afterDeny = policy.explain('bob', 'doc:read', '/x/y');
      out.removeAgain = policy.removeStatement('d');
      out.removeAllow = policy.removeStatement('a');
      out.afterAllow = policy.explain('bob', 'doc:read', '/x/y');
      out.reuse = ok(attempt(() => policy.addStatement(allow('a', ['viewer'], ['doc:write'], ['/x']))));
      out.reused = [policy.check('bob', 'doc:write', '/x'), policy.check('bob', 'doc:read', '/x')];
      out.unknownRemove = policy.removeStatement('nope');
      return out;
    },
  },
  {
    name: 'an unknown user is denied and is not an error, and a star role reaches every known user',
    run: async ({ load }) => {
      const { policy } = await make(load, [allow('everyone', ['*'], ['doc:read'], ['/pub']), allow('named', ['viewer'], ['doc:list'], ['/pub'])]);
      return {
        unknown: [policy.explain('nobody', 'doc:read', '/pub'), policy.check('nobody', 'doc:read', '/pub'), policy.effectiveRoles('nobody')],
        known: ['ann', 'bob', 'cy', 'dee'].map((user) => policy.check(user, 'doc:read', '/pub')),
        noRoles: (() => {
          policy.setUser('pat', {});
          return [policy.check('pat', 'doc:read', '/pub'), policy.check('pat', 'doc:list', '/pub'), policy.effectiveRoles('pat')];
        })(),
        badRequest: [attempt(() => policy.check('nobody', 'read', '/pub')), attempt(() => policy.check('nobody', 'doc:read', 'pub'))],
      };
    },
  },
  {
    name: 'a scripted matrix of users, actions and resources',
    run: async ({ load }) => {
      const { policy, clock } = await make(load, [
        allow('v-read', ['viewer'], ['doc:read', 'doc:list'], ['/org/**/docs', '/pub']),
        allow('e-write', ['editor'], ['doc:write'], ['/org/*/docs'], { conditions: { owner: true } }),
        allow('a-all', ['admin'], ['*'], ['/org']),
        deny('no-secret', ['viewer'], ['doc:*'], ['/org/hr']),
        deny('no-delete', ['editor'], ['doc:delete'], ['/**/audit/**']),
        allow('own-home', ['*'], ['doc:*'], ['/homes/${user.id}']),
        deny('night-write', ['*'], ['doc:write'], ['/org'], { conditions: { between: [0, 10] } }),
        allow('aud', ['auditor'], ['doc:read'], ['/org/hr', '/org/audit'], { conditions: { attrs: { dept: 'ops' }, mfa: true } }),
      ]);
      policy.defineGroup('guests', ['viewer']);
      policy.setUser('gil', { groups: ['guests'] });
      const users = ['ann', 'bob', 'cy', 'dee', 'gil', 'ghost'];
      const requests = [
        ['doc:read', '/org/eng/docs'],
        ['doc:write', '/org/eng/docs', { owner: 'ann' }],
        ['doc:write', '/org/eng/docs', { owner: 'cy' }],
        ['doc:read', '/org/hr/docs'],
        ['doc:read', '/org/hr', { mfa: true }],
        ['doc:delete', '/org/audit/2024'],
        ['doc:list', '/pub/readme'],
        ['doc:read', '/homes/ann/notes'],
        ['doc:read', '/homes/bob'],
      ];
      const rows = [];
      for (const at of [5, 50]) {
        clock.set(at);
        for (const user of users) rows.push(`${at}:${user}:${requests.map(([action, resource, context]) => (policy.check(user, action, resource, context) ? 'y' : 'n')).join('')}`);
      }
      return rows;
    },
  },
];
