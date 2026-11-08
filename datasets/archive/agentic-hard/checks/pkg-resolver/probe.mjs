// Hidden probes for agentic-hard-pkg-resolver; expected.json holds the answers.
// Every probe goes through the public exports of src/index.mjs.
const lib = (load) => load('src/index.mjs');
const outcome = (fn) => {
  try {
    return { ok: fn() };
  } catch (error) {
    return { threw: error.constructor.name, pkg: error.pkg, path: error.path, requirements: error.requirements && error.requirements.map((r) => `${r.from} wants ${r.range}`).sort() };
  }
};
const tryRange = (satisfies, version, range) => {
  try {
    return satisfies(version, range);
  } catch {
    return 'threw';
  }
};
// Registry helper: spec 'name@version:dep=range,dep=range'
const reg = async (load, spec) => {
  const { Registry } = await lib(load);
  const packages = {};
  for (const line of spec) {
    const [id, deps = ''] = line.split(':');
    const [name, version] = id.split('@');
    packages[name] ??= {};
    packages[name][version] = Object.fromEntries(deps.split(',').filter(Boolean).map((d) => d.split('=')));
  }
  return new Registry(packages);
};

export const probes = [
  {
    name: 'keeps core versions compared as numbers',
    run: async ({ load }) => {
      const { compare, sort, valid } = await lib(load);
      return [sort(['1.9.0', '1.10.0', '1.2.0', '10.0.0', '2.0.0']), compare('1.0.0', '1.0.0'), compare('1.0.0+a', '1.0.0+b'), valid('1.2.3'), valid('1.2'), valid('01.2.3'), compare('1.0.0-alpha', '1.0.0')];
    },
  },
  {
    name: 'prerelease versions follow the semver precedence rules',
    run: async ({ load }) => {
      const { compare, sort } = await lib(load);
      const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
      const shuffled = [ordered[5], ordered[0], ordered[7], ordered[2], ordered[6], ordered[1], ordered[4], ordered[3]];
      return [sort(shuffled), compare('1.0.0-2', '1.0.0-10'), compare('1.0.0-1', '1.0.0-a'), compare('1.0.0-a.1', '1.0.0-a')];
    },
  },
  {
    name: 'caret ranges, including the 0.x rules',
    run: async ({ load }) => {
      const { satisfies } = await lib(load);
      const cases = [['1.9.9', '^1.2.3'], ['2.0.0', '^1.2.3'], ['1.2.2', '^1.2.3'], ['0.2.9', '^0.2.3'], ['0.3.0', '^0.2.3'], ['0.0.3', '^0.0.3'], ['0.0.4', '^0.0.3'], ['1.9.0', '^1.2'], ['2.0.0', '^1.2'], ['1.0.0', '^1'], ['0.9.0', '^0'], ['1.0.0', '^0'], ['0.0.9', '^0.0'], ['0.1.0', '^0.0']];
      return cases.map(([v, r]) => tryRange(satisfies, v, r));
    },
  },
  {
    name: 'tilde ranges, with and without a patch',
    run: async ({ load }) => {
      const { satisfies } = await lib(load);
      const cases = [['1.2.9', '~1.2.3'], ['1.3.0', '~1.2.3'], ['1.2.9', '~1.2'], ['1.3.0', '~1.2'], ['1.9.9', '~1'], ['2.0.0', '~1'], ['0.2.5', '~0.2.3'], ['0.3.0', '~0.2.3']];
      return cases.map(([v, r]) => tryRange(satisfies, v, r));
    },
  },
  {
    name: 'x-ranges and the star',
    run: async ({ load }) => {
      const { satisfies } = await lib(load);
      const cases = [['1.5.0', '1.x'], ['2.0.0', '1.x'], ['1.2.9', '1.2.x'], ['1.3.0', '1.2.x'], ['1.2.9', '1.2.*'], ['3.4.5', '*'], ['3.4.5', 'x'], ['3.4.5', ''], ['1.5.0', '1'], ['1.2.5', '1.2'], ['1.3.0', '1.2'], ['1.2.3', '=1.2.3']];
      return cases.map(([v, r]) => tryRange(satisfies, v, r));
    },
  },
  {
    name: 'dash ranges',
    run: async ({ load }) => {
      const { satisfies } = await lib(load);
      const cases = [['1.2.3', '1.2.3 - 2.3.4'], ['2.3.4', '1.2.3 - 2.3.4'], ['2.3.5', '1.2.3 - 2.3.4'], ['1.2.2', '1.2.3 - 2.3.4'], ['2.3.9', '1.2.3 - 2.3'], ['2.4.0', '1.2.3 - 2.3'], ['2.9.9', '1.2.3 - 2'], ['3.0.0', '1.2.3 - 2'], ['1.2.0', '1.2 - 2.0.0']];
      return cases.map(([v, r]) => tryRange(satisfies, v, r));
    },
  },
  {
    name: 'keeps comparators and alternatives',
    run: async ({ load }) => {
      const { satisfies } = await lib(load);
      const cases = [['1.2.3', '>=1.2.3 <2.0.0'], ['2.0.0', '>=1.2.3 <2.0.0'], ['1.2.4', '>1.2.3'], ['1.2.3', '>1.2.3'], ['1.2.3', '<=1.2.3'], ['3.5.0', '>=1.0.0 <2.0.0 || >=3.0.0 <4.0.0'], ['2.5.0', '>=1.0.0 <2.0.0 || >=3.0.0 <4.0.0'], ['0.5.0', '<1.0.0 || >2.0.0'], ['1.5.0', '<1.0.0 || >2.0.0'], ['1.2.3', '>= 1.2.3'], ['1.2.3', '>=1.2.3 <=1.2.3']];
      return cases.map(([v, r]) => tryRange(satisfies, v, r));
    },
  },
  {
    name: 'a prerelease only satisfies a set that names a prerelease of the same version',
    run: async ({ load }) => {
      const { satisfies } = await lib(load);
      const cases = [['2.0.0-beta.1', '>=1.0.0'], ['1.5.0-rc.1', '^1.2.3'], ['1.2.3-beta.2', '^1.2.3-beta.1'], ['1.2.4-beta.1', '^1.2.3-beta.1'], ['1.2.3-beta.1', '^1.2.3'], ['2.0.0-rc.1', '<2.0.0'], ['1.2.3-alpha', '>=1.2.3-alpha <1.3.0'], ['1.2.3-alpha', '*'], ['1.2.3-beta.1', '1.2.3-beta.1'], ['1.2.3-beta.1', '1.2.3'], ['3.0.0-pre', '>=2.0.0 || >=3.0.0-pre']];
      return cases.map(([v, r]) => tryRange(satisfies, v, r));
    },
  },
  {
    name: 'maxSatisfying picks the highest release by number',
    run: async ({ load }) => {
      const { maxSatisfying } = await lib(load);
      return [maxSatisfying(['1.9.0', '1.10.0', '1.2.0', '2.0.0'], '^1'), maxSatisfying(['1.0.0', '1.1.0-beta.1', '1.0.5'], '^1'), maxSatisfying(['1.0.0', '2.0.0'], '^3'), maxSatisfying(['1.9.0', '1.10.0', '1.2.0'], '1.x'), maxSatisfying(['0.2.3', '0.2.10', '0.2.9', '0.3.0'], '^0.2.3'), maxSatisfying(['1.0.0', '1.2.0-rc.1'], '>=1.0.0-0')];
    },
  },
  {
    name: 'keeps a nonsense range an error',
    run: async ({ load }) => {
      const { satisfies } = await lib(load);
      return [tryRange(satisfies, '1.0.0', 'banana'), tryRange(satisfies, '1.0.0', '>=1.0.0 ?'), satisfies('not a version', '*')];
    },
  },
  {
    name: 'the highest version wins whatever the order of the registry',
    run: async ({ load }) => {
      const { resolve } = await lib(load);
      const one = await reg(load, ['a@1.9.0', 'a@1.10.0', 'a@1.2.0', 'a@2.0.0', 'a@1.11.0-beta.1']);
      const two = await reg(load, ['a@2.0.0', 'a@1.2.0', 'a@1.10.0', 'a@1.11.0-beta.1', 'a@1.9.0']);
      return [resolve({ a: '^1.0.0' }, one), resolve({ a: '^1.0.0' }, two), resolve({ a: '>=1.0.0' }, one)];
    },
  },
  {
    name: 'a prerelease is not chosen unless the range asks for it',
    run: async ({ load }) => {
      const { resolve } = await lib(load);
      const registry = await reg(load, ['a@1.0.0', 'a@2.0.0-beta.1', 'p@2.0.0-beta.1', 'p@2.0.0-beta.2']);
      return [outcome(() => resolve({ a: '>=1.0.0' }, registry)), outcome(() => resolve({ a: '>=2.0.0-beta.1' }, registry)), outcome(() => resolve({ p: '^2.0.0' }, registry)), outcome(() => resolve({ p: '^2.0.0-beta.1' }, registry))];
    },
  },
  {
    name: 'two requirements on one package are both honoured',
    run: async ({ load }) => {
      const { resolve } = await lib(load);
      const registry = await reg(load, ['a@1.0.0:b=^1.0.0', 'c@1.0.0:b=~1.2.0', 'b@1.0.5', 'b@1.2.0', 'b@1.2.9', 'b@1.3.0']);
      return [resolve({ a: '^1.0.0', c: '^1.0.0' }, registry), resolve({ c: '^1.0.0', a: '^1.0.0' }, registry)];
    },
  },
  {
    name: 'an older version is tried when the newest one cannot work',
    run: async ({ load }) => {
      const { resolve } = await lib(load);
      const registry = await reg(load, ['a@1.0.0:c=^1.0.0', 'a@1.1.0:c=^2.0.0', 'b@1.0.0:c=^1.0.0', 'c@1.0.0', 'c@2.0.0']);
      return [resolve({ a: '^1.0.0', b: '^1.0.0' }, registry), resolve({ b: '^1.0.0', a: '^1.0.0' }, registry)];
    },
  },
  {
    name: 'backtracking works several levels deep',
    run: async ({ load }) => {
      const { resolve } = await lib(load);
      const registry = await reg(load, ['app@1.0.0:lib=^1.0.0,util=^1.0.0', 'lib@1.2.0:core=^3.0.0', 'lib@1.1.0:core=^2.0.0', 'lib@1.0.0:core=^1.0.0', 'util@1.0.0:core=~2.1.0', 'core@3.0.0', 'core@2.2.0', 'core@2.1.4', 'core@2.1.0', 'core@1.0.0']);
      return resolve({ app: '^1.0.0' }, registry);
    },
  },
  {
    name: 'a conflict names the package and who asked for what',
    run: async ({ load }) => {
      const { resolve } = await lib(load);
      const registry = await reg(load, ['b@1.0.0', 'b@2.0.0', 'c@1.0.0:b=^2.0.0']);
      return outcome(() => resolve({ b: '^1.0.0', c: '^1.0.0' }, registry));
    },
  },
  {
    name: 'keeps an unsatisfiable range a conflict, and a missing package not found',
    run: async ({ load }) => {
      const { resolve } = await lib(load);
      const registry = await reg(load, ['a@1.0.0', 'a@2.0.0']);
      return [outcome(() => resolve({ a: '^3.0.0' }, registry)), outcome(() => resolve({ zzz: '^1.0.0' }, registry))];
    },
  },
  {
    name: 'a cycle reports the whole loop',
    run: async ({ load }) => {
      const { resolve } = await lib(load);
      const three = await reg(load, ['a@1.0.0:b=^1.0.0', 'b@1.0.0:c=^1.0.0', 'c@1.0.0:a=^1.0.0']);
      const entry = await reg(load, ['x@1.0.0:a=^1.0.0', 'a@1.0.0:b=^1.0.0', 'b@1.0.0:a=^1.0.0']);
      const self = await reg(load, ['s@1.0.0:s=^1.0.0']);
      return [outcome(() => resolve({ a: '^1.0.0' }, three)), outcome(() => resolve({ x: '^1.0.0' }, entry)), outcome(() => resolve({ s: '^1.0.0' }, self)), outcome(() => resolve({ b: '^1.0.0' }, three))];
    },
  },
  {
    name: 'a cycle error is a resolution error with a readable message',
    run: async ({ load }) => {
      const { resolve, ResolutionError, CycleError } = await lib(load);
      const registry = await reg(load, ['a@1.0.0:b=^1.0.0', 'b@1.0.0:c=^1.0.0', 'c@1.0.0:a=^1.0.0']);
      try {
        resolve({ a: '^1.0.0' }, registry);
        return 'returned';
      } catch (error) {
        return [error instanceof ResolutionError, error instanceof CycleError, error.message.includes('a -> b -> c -> a')];
      }
    },
  },
  {
    name: 'keeps shared dependencies out of the cycle check',
    run: async ({ load }) => {
      const { resolve } = await lib(load);
      const registry = await reg(load, ['top@1.0.0:left=^1.0.0,right=^1.0.0', 'left@1.0.0:base=^1.0.0,leaf=^1.0.0', 'right@1.0.0:base=^1.0.0,leaf=^1.0.0', 'base@1.0.0:leaf=^1.0.0', 'leaf@1.0.0']);
      return outcome(() => resolve({ top: '^1.0.0' }, registry));
    },
  },
  {
    name: 'keeps lockfile and tree output',
    run: async ({ load }) => {
      const { resolve, toLockfile, fromLockfile, renderTree } = await lib(load);
      const registry = await reg(load, ['app@2.0.0:zed=^1.0.0,beta=^2.0.0', 'zed@1.4.0', 'beta@2.1.0:zed=^1.0.0', 'beta@2.0.0']);
      const deps = { app: '^2.0.0' };
      const result = resolve(deps, registry);
      const lock = toLockfile(result, registry);
      return { result, order: Object.keys(JSON.parse(lock).packages), back: fromLockfile(lock), tree: renderTree(deps, result, registry).split('\n') };
    },
  },
  {
    name: 'keeps a long chain of packages resolving',
    run: async ({ load }) => {
      const { resolve } = await lib(load);
      const spec = [];
      for (let i = 0; i < 150; i += 1) {
        spec.push(`p${i}@1.0.0${i < 149 ? `:p${i + 1}=^1.0.0` : ''}`, `p${i}@1.1.0${i < 149 ? `:p${i + 1}=^1.0.0` : ''}`);
      }
      const registry = await reg(load, spec);
      const result = resolve({ p0: '^1.0.0' }, registry);
      return [Object.keys(result).length, result.p0, result.p149];
    },
  },
];
