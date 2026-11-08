import { t, rng, randInt, pick } from './_util.mjs';

const task = [
  'Write a dependency resolver. resolveDeps(registry, root) returns the versions to install, or null.',
  'registry maps a package name to an object that maps each version of the package to the dependencies of that version, for example { "a": { "1.0.0": { "b": "^1.2.0" }, "1.1.0": {} } }. A dependency is a package name with a range string. root is an object of the same kind: the ranges that the user asks for. The keys of every dependency object are in the order in which the dependencies are listed.',
  'Versions. A version is MAJOR.MINOR.PATCH, three integers of 0 or more, with an optional prerelease: a hyphen and dot-separated identifiers of letters and digits, as in "1.2.3-beta.2". Versions are ordered by MAJOR, then MINOR, then PATCH. With equal numbers, a version with a prerelease is lower than the same version without one. Two prereleases are compared identifier by identifier from the left: two numeric identifiers (digits only) by their number; a numeric identifier is lower than an identifier with a letter; two identifiers with letters in plain character order; when all shared identifiers are equal, the one with fewer identifiers is lower.',
  'Ranges. A range is one or more alternatives separated by "||"; a version satisfies the range when it satisfies at least one alternative. An alternative is comparators separated by spaces (all must hold), or two versions with " - " between them (a hyphen range). A blank alternative holds for any version (but see the prerelease rule). Spaces around an alternative are ignored. A comparator is an optional operator followed by a version, with no space between them.',
  'A partial version has 1 or 2 numbers ("1", "1.2"), or has an x, X or * in place of the minor or patch number ("1.x", "1.2.*"); the parts that are not given are wild. "*", "x" and "X" alone match any version. The comparators: (1) No operator, or "=": a full version matches itself (its prerelease must be equal); a partial version matches every version from its lowest (the missing parts are 0) up to, but not including, the next one: "1.2" means >=1.2.0 and <1.3.0, and "1" means >=1.0.0 and <2.0.0. (2) ">=" and "<" compare with the version, a partial version being filled with 0. (3) ">": for a full version, higher than it; for a partial version, the next version or higher: ">1.2" is >=1.3.0 and ">1" is >=2.0.0. (4) "<=": for a full version, at most it; for a partial version, lower than the next version: "<=1.2" is <1.3.0. (5) "!=": different from a full version; for a partial version, outside the range that it means without an operator, so "!=1.2" excludes every 1.2.x. (6) "~": at least the version (filled with 0) and below the next minor version ("~1.2.3" and "~1.2" mean <1.3.0), or below the next major version when only the major number is given ("~1" means <2.0.0). (7) "^": at least the version (filled with 0) and below the next version that changes the left-most non-zero number among the numbers given: ^1.2.3 is <2.0.0, ^0.2.3 is <0.3.0, ^0.0.3 is <0.0.4, ^1.2 is <2.0.0, ^0.0 is <0.1.0 and ^0 is <1.0.0. A hyphen range "A - B" means at least A (filled with 0), and at most B for a full B, or below the next version of B for a partial B: "1.2.3 - 2.3" means >=1.2.3 and <2.4.0.',
  'Prerelease rule. A version with a prerelease satisfies an alternative only if all its comparators hold and at least one comparator of that alternative has a prerelease on a full version with the same MAJOR.MINOR.PATCH numbers. A "!=" comparator never counts for this, and in a hyphen range both of its versions count. A version without a prerelease needs only the comparators.',
  'Resolution. Pick one version for each package that is needed, so that every range required for a package holds for the picked version, by this exact search. Keep a list of package names in the order in which they are first required: first the keys of root, in their order. Whenever a package gets a version, the dependencies of that version are required, and a dependency that is not in the list yet is added to the end of the list. The search goes through the list in order, one package per step. At the step of a package, the candidates are the versions in registry that satisfy all ranges required for the package so far (by root and by the packages that were picked before), highest version first. Try each candidate in turn: pick it and require its dependencies; if one of its dependencies is a package that is already picked and the picked version does not satisfy the new range, or if the later steps fail, undo this pick (and the ranges and list entries it added) and go on with the next candidate. If no candidate works, the step fails, and the step before it goes on with its next candidate. A package that is not in registry has no candidates. The search ends when every package in the list has a version.',
  'The result is null when the first step fails. Otherwise it is an array of [name, version] pairs, sorted by name in plain character order, one for each picked package.',
].join(' ');

const reg = (spec) => spec;

// A seeded world: packages a, b, c, ... each with several versions (some with a prerelease), dependencies with every kind of range.
function world(seed, size) {
  const rand = rng(seed);
  const names = 'abcdefghijkl'.slice(0, size).split('');
  const pool = {};
  for (const name of names) {
    const list = new Set();
    const count = randInt(rand, 4, 7);
    while (list.size < count) {
      const v = [randInt(rand, 0, 3), randInt(rand, 0, 3), randInt(rand, 0, 4)].join('.');
      list.add(rand() < 0.2 ? `${v}-${pick(rand, ['alpha', 'beta.2', 'beta.11', 'rc.1'])}` : v);
    }
    pool[name] = [...list];
  }
  const triple = (v) => v.split('-')[0].split('.').map(Number);
  const rangeFor = (name) => {
    const target = pick(rand, pool[name]);
    const [x, y, z] = triple(target);
    const full = target;
    const options = [
      `^${full}`, `~${full}`, `>=${full}`, `^${x}.${y}`, `~${x}`, `${x}.x`, `${x}.${y}`, `>${x}.${y}`, `<=${x}.${y}`, `!=${x}.${y}`, `>=${x}.${y} <${x + 1}`,
      `${x}.${y}.${z} - ${x + 1}.${y}`, `^${x} || ^${x + 2}`, `>=${x}.0.0 !=${x}.${y}`, `<${x + 1}.${y}.0 >${x}.0`, `=${full}`, `*`, `^${x}.${y}.${z}-beta.2 || ${x + 1}.x`,
      `>=${x}.${y}.${z}-alpha <${x}.${y}.${z + 1}`,
    ];
    return pick(rand, options);
  };
  const registry = {};
  for (const name of names) {
    registry[name] = {};
    for (const version of pool[name]) {
      const deps = {};
      const count = randInt(rand, 0, 2);
      for (let i = 0; i < count; i += 1) {
        const other = pick(rand, names);
        if (other !== name || rand() < 0.1) deps[other] = rangeFor(other);
      }
      registry[name][version] = deps;
    }
  }
  const root = {};
  for (const name of names.slice(0, 3)) root[name] = rangeFor(name);
  return [registry, root];
}


export default {
  slug: 'dep-resolver',
  tier: {
    level: 4,
    human_minutes: 100,
    basis: 'estimated from the reference (about 190 lines): a range grammar with ten operator rules, a prerelease ordering and a prerelease permission rule, and a depth-first search whose order of steps, candidate order and undo of ranges are fixed; about 25 interacting rules, and an expert needs an hour and a half to implement and check each one',
  },
  tags: ['spec', 'parsing'],
  name: 'resolveDeps',
  signature: 'resolveDeps(registry, root) -> array | null',
  task,
  edges: {
    highest: 'highest version first',
    'caret-zero': '^0.2.3 is <0.3.0',
    tilde: 'below the next minor version',
    hyphen: '"1.2.3 - 2.3" means >=1.2.3 and <2.4.0',
    'partial-gt': '">1.2" is >=1.3.0',
    'partial-lte': '"<=1.2" is <1.3.0',
    'not-equal': 'so "!=1.2" excludes every 1.2.x',
    or: 'separated by "||"',
    blank: 'A blank alternative holds for any version',
    'prerelease-order': 'a numeric identifier is lower than an identifier with a letter',
    'prerelease-rule': 'at least one comparator of that alternative has a prerelease',
    'exact-pre': 'its prerelease must be equal',
    backtrack: 'undo this pick',
    'picked-conflict': 'is already picked',
    order: 'in the order in which they are first required',
    missing: 'A package that is not in registry has no candidates',
    null: 'The result is null when the first step fails',
  },
  tests: [
    t('highest', [reg({ a: { '1.0.0': {}, '1.2.0': {}, '1.9.9': {}, '2.0.0': {} } }), { a: '^1.0.0' }], [['a', '1.9.9']]),
    // ~1.2 is >=1.2.0 <1.3.0: 1.2.9. ^0.2.5 is >=0.2.5 <0.3.0: 0.2.9. ^0.0.3 is >=0.0.3 <0.0.4: 0.0.3.
    t('caret-zero', [reg({
      p: { '1.0.0': {}, '1.2.3': {}, '1.2.9': {}, '1.3.0': {}, '2.0.0': {} },
      q: { '0.1.0': {}, '0.2.5': {}, '0.2.9': {}, '0.3.0': {}, '1.0.0': {} },
      r: { '0.0.3': {}, '0.0.4': {}, '0.0.5': {} },
    }), { p: '~1.2', q: '^0.2.5', r: '^0.0.3' }], [['p', '1.2.9'], ['q', '0.2.9'], ['r', '0.0.3']]),
    // s: 1.0.0 - 2.1 is >=1.0.0 <2.2.0: 2.1.9. u: ">1.2" is >=1.3.0, so 1.2.7 is out of the first alternative; 0.5.x gives 0.5.1.
    // w: <=1.2 is <1.3.0, without 1.2.1: 1.2.0. v: >=1.1 without every 1.2.x (not only 1.2.0) leaves 1.1.0.
    t('hyphen', [reg({
      s: { '1.0.0': {}, '2.1.9': {}, '2.2.0': {}, '3.0.0': {} },
      u: { '0.5.1': {}, '1.2.7': {} },
      w: { '1.0.0': {}, '1.1.0': {}, '1.2.0': {}, '1.2.1': {}, '1.3.0': {} },
      v: { '1.1.0': {}, '1.2.0': {}, '1.2.4': {} },
    }), { s: '1.0.0 - 2.1', u: '>1.2 <2 || 0.5.x', w: '<=1.2 !=1.2.1', v: '>=1.1 !=1.2' }], [['s', '2.1.9'], ['u', '0.5.1'], ['v', '1.1.0'], ['w', '1.2.0']]),
    // a: from 1.0.0-alpha.1 up to 1.0.0-beta.11: beta.11 is the highest (11 > 2, as numbers). b: ^1.0.0 has no prerelease comparator, so 1.0.0-rc.1 is out: 1.2.0.
    // c: ^1.2.0-beta allows prereleases of 1.2.0 only: 1.2.0-rc.1 beats 1.2.0-beta, and 1.2.1-beta is out. d: the exact prerelease.
    t('prerelease-order', [reg({
      a: { '1.0.0-alpha': {}, '1.0.0-alpha.1': {}, '1.0.0-alpha.beta': {}, '1.0.0-beta': {}, '1.0.0-beta.2': {}, '1.0.0-beta.11': {}, '1.0.0-rc.1': {}, '1.0.0': {} },
      b: { '1.0.0-rc.1': {}, '1.0.0': {}, '1.2.0-beta': {}, '1.2.0': {} },
      c: { '1.2.0-beta': {}, '1.2.0-rc.1': {}, '1.2.1-beta': {} },
      d: { '2.0.0-rc.1': {}, '2.0.0-rc.2': {}, '2.0.0': {} },
    }), { a: '<=1.0.0-beta.11 >=1.0.0-alpha.1', b: '^1.0.0', c: '^1.2.0-beta', d: '2.0.0-rc.1' }], [['a', '1.0.0-beta.11'], ['b', '1.2.0'], ['c', '1.2.0-rc.1'], ['d', '2.0.0-rc.1']]),
    // A blank range and "*" take the highest version without a prerelease.
    t('blank', [reg({ e: { '0.1.0': {}, '3.0.0-rc.1': {}, '2.0.0': {} }, f: { '1.0.0': {}, '1.1.0-beta': {} } }), { e: '', f: '*' }], [['e', '2.0.0'], ['f', '1.0.0']]),
    // Alternatives: ^1.0.0 gives 1.0.0; ">=3.5 <4" gives 3.5.0; the highest is 3.5.0.
    t('or', [reg({ h: { '1.0.0': {}, '2.0.0': {}, '3.5.0': {}, '4.0.0': {} } }), { h: '^1.0.0  ||  >=3.5 <4' }], [['h', '3.5.0']]),
    // a 2.0.0 requires c ^2 and b 1.0.0 requires c ^1: step c has no candidate, so b fails, so a goes to 1.0.0 (c ^1), b 1.0.0, c 1.5.0.
    t('backtrack', [reg({
      a: { '1.0.0': { c: '^1.0.0' }, '2.0.0': { c: '^2.0.0' } },
      b: { '1.0.0': { c: '^1.0.0' } },
      c: { '1.5.0': {}, '2.1.0': {} },
    }), { a: '*', b: '*' }], [['a', '1.0.0'], ['b', '1.0.0'], ['c', '1.5.0']]),
    // a is picked at 2.0.0 (highest). b 2.0.0 needs a ^1, which the picked a does not satisfy: b goes to 1.0.0 (a ^2).
    t('picked-conflict', [reg({
      a: { '2.0.0': {}, '1.0.0': {} },
      b: { '2.0.0': { a: '^1.0.0' }, '1.0.0': { a: '^2.0.0' } },
    }), { a: '*', b: '*' }], [['a', '2.0.0'], ['b', '1.0.0']]),
    // b comes first in root: b 2.0.0 (c 2.0.0), then a 2.0.0 needs c 1.0.0 and fails at c, so a 1.0.0 (c 2.0.0).
    t('order', [reg({
      a: { '2.0.0': { c: '1.0.0' }, '1.0.0': { c: '2.0.0' } },
      b: { '2.0.0': { c: '2.0.0' }, '1.0.0': { c: '1.0.0' } },
      c: { '1.0.0': {}, '2.0.0': {} },
    }), { b: '*', a: '*' }], [['a', '1.0.0'], ['b', '2.0.0'], ['c', '2.0.0']]),
    // a 1.0.0 needs b, which is not in the registry; a 0.9.0 needs nothing.
    t('missing', [reg({ a: { '1.0.0': { b: '^1.0.0' }, '0.9.0': {} } }), { a: '*' }], [['a', '0.9.0']]),
    t('null', [reg({ a: { '2.0.0': {} } }), { a: '^1.0.0' }], null),
    // Seeded worlds of 8 to 12 packages with all kinds of ranges, prereleases and cycles; 6 to 10 packages end up picked.
    t('tilde', world(314, 8)),
    t('partial-gt', world(105, 9)),
    t('partial-lte', world(117, 10)),
    t('not-equal', world(401, 10)),
    t('prerelease-rule', world(141, 11)),
    t('exact-pre', world(62, 12)),
    t('highest', world(36, 8)),
    t('or', world(28, 11)),
  ],
};
