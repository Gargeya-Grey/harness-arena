// Hidden probes for ladder-agent-build-scheduler; expected.json holds the answers.
const lib = (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};
const T = (deps = [], cost = 1, more = {}) => ({ recipe: 'r', deps, cost, ...more });
const S = (source) => ({ source });

/** A run function with a log. fail: always fail; until: fail while attempt <= n; out: fixed output; boom: throw; junk: bad result. */
function runner({ fail = [], until = {}, out = {}, boom = [], junk = {} } = {}) {
  const calls = [];
  const run = (name, info) => {
    calls.push(`${name}#${info.attempt}`);
    if (boom.includes(name)) throw new Error(`${name} exploded`);
    if (name in junk) return junk[name];
    if (fail.includes(name) || info.attempt <= (until[name] ?? 0)) return { ok: false, error: `${name} broke` };
    return { ok: true, output: out[name] ?? `${name}(${Object.values(info.deps).join(',')})` };
  };
  return { run, calls };
}

const caught = (fn) => {
  try {
    fn();
    return 'no error';
  } catch (error) {
    const { code, target, dep, path } = error;
    return error.constructor.name === 'GraphError' ? { code, target: target ?? null, dep: dep ?? null, path: path ?? null } : error.constructor.name;
  }
};

/** Compact view of a result: status[:reason or cause]@start-end/slot per target. */
const view = (res) =>
  Object.fromEntries(
    Object.entries(res.targets).map(([name, t]) => [name, `${t.status}${t.reason ? `:${t.reason}` : ''}${t.cause ? `:${t.cause}` : ''}${t.start !== undefined ? `@${t.start}-${t.end}/${t.slot}x${t.attempts}` : ''}`]),
  );

async function go(load, graph, options = {}, behaviour = {}) {
  const { build } = await lib(load);
  const r = runner(behaviour);
  const res = build(graph, { run: r.run, ...options });
  return { res, calls: r.calls, build, again: (g, o = {}, b = {}) => { const r2 = runner(b); const res2 = build(g, { run: r2.run, cache: res.cache, ...o }); return { res: res2, calls: r2.calls }; } };
}

const FIVE = () => ({ a: T([], 5), b: T([], 5), c: T(['a', 'b'], 1), d: T(['a'], 1) });

export const probes = [
  {
    name: 'keeps the exports',
    run: async ({ load }) => Object.keys(await lib(load)).sort(),
  },
  {
    name: 'one slot plays targets one after another and the makespan adds the costs',
    run: async ({ load }) => {
      const { res } = await go(load, { p: T([], 7), q: T(['p'], 3), r: T(['q'], 2) });
      return { order: res.startOrder, makespan: res.makespan, view: view(res), ok: res.ok };
    },
  },
  {
    name: 'the result has exactly the documented keys',
    run: async ({ load }) => {
      const { res } = await go(load, { s: S('x'), a: T(['s'], 2, { retries: 1 }), f: T([], 1), g: T(['f'], 1) }, { slots: 2 }, { fail: ['f'] });
      return { top: Object.keys(res).sort(), source: res.targets.s, built: Object.keys(res.targets.a).sort(), failed: Object.keys(res.targets.f).sort(), skipped: Object.keys(res.targets.g).sort(), stats: res.stats };
    },
  },
  {
    name: 'ready targets start by the longest remaining path first',
    run: async ({ load }) => {
      const { res } = await go(load, { a: T([], 5), b: T([], 1), c: T(['b'], 10) });
      return res.startOrder;
    },
  },
  {
    name: 'equal weights go to the smaller name',
    run: async ({ load }) => {
      const { res } = await go(load, { z: T([], 4), m: T([], 4), k: T([], 4), B: T([], 4), a: T([], 4) });
      return res.startOrder;
    },
  },
  {
    name: 'a weight adds the own cost to the largest dependent, not to their sum',
    run: async ({ load }) => {
      const { res } = await go(load, { w: T([], 7), x: T([], 2), y: T(['x'], 3), z: T(['x'], 4) });
      return res.startOrder;
    },
  },
  {
    name: 'a source adds nothing to a weight and takes no slot or time',
    run: async ({ load }) => {
      const { res } = await go(load, { s: S('q'), u: T(['s'], 3), v: T([], 4), w: T(['s'], 2) });
      return { order: res.startOrder, makespan: res.makespan, view: view(res) };
    },
  },
  {
    name: 'two slots run independent targets together',
    run: async ({ load }) => {
      const { res } = await go(load, { x: T([], 10), y: T([], 6), z: T(['x', 'y'], 2) }, { slots: 2 });
      return { view: view(res), makespan: res.makespan };
    },
  },
  {
    name: 'more slots than targets leave slots unused',
    run: async ({ load }) => {
      const { res } = await go(load, { x: T([], 3), y: T([], 3) }, { slots: 9 });
      return { view: view(res), makespan: res.makespan };
    },
  },
  {
    name: 'a free slot is the lowest numbered free slot',
    run: async ({ load }) => {
      const one = await go(load, { a: T([], 20), b: T([], 3), c: T([], 5), f: T(['c'], 1) }, { slots: 3 });
      const two = await go(load, { a: T([], 20), b: T([], 3), c: T([], 5), f: T(['c'], 1), g: T(['a', 'b'], 10) }, { slots: 3 });
      return { one: view(one.res), two: view(two.res) };
    },
  },
  {
    name: 'every job that ends at an instant frees its slot before the next jobs start',
    run: async ({ load }) => {
      const { res } = await go(load, FIVE(), { slots: 2 });
      return { view: view(res), order: res.startOrder };
    },
  },
  {
    name: 'a zero cost target starts and ends at the same instant',
    run: async ({ load }) => {
      const { res } = await go(load, { a: T([], 0), b: T(['a'], 0), c: T(['b'], 5), d: T(['a'], 0) });
      return { view: view(res), makespan: res.makespan };
    },
  },
  {
    name: 'a zero cost target frees its slot for the next target at the same instant',
    run: async ({ load }) => {
      const { res } = await go(load, { a: T([], 0), b: T([], 0), c: T(['a'], 3), d: T(['b'], 3), e: T([], 3) }, { slots: 1 });
      return { view: view(res), order: res.startOrder };
    },
  },
  {
    name: 'run gets the attempt, the recipe and the outputs of the deps in deps order',
    run: async ({ load }) => {
      const { build } = await lib(load);
      const seen = [];
      const run = (name, info) => {
        seen.push([name, info.attempt, info.recipe, Object.entries(info.deps)]);
        return { ok: true, output: `out-${name}` };
      };
      build({ q: S('from q'), p: { recipe: 'make p', cost: 1 }, t: { recipe: 'make t', deps: ['q', 'p'], cost: 1 } }, { run });
      return seen;
    },
  },
  {
    name: 'run is called when a target starts, in start order',
    run: async ({ load }) => {
      const { calls } = await go(load, { a: T([], 5), b: T([], 2), c: T(['b'], 2) }, { slots: 2 });
      return calls;
    },
  },
  {
    name: 'a second build with the returned cache runs nothing and takes no time',
    run: async ({ load }) => {
      const first = await go(load, { a: T([], 4), b: T(['a'], 4), s: S('t') });
      const second = first.again({ a: T([], 4), b: T(['a'], 4), s: S('t') });
      return { calls: second.calls, view: view(second.res), makespan: second.res.makespan, order: second.res.startOrder, stats: second.res.stats };
    },
  },
  {
    name: 'a changed recipe rebuilds that target, a changed output rebuilds its dependents',
    run: async ({ load }) => {
      const g = () => ({ a: T([], 2), b: T(['a'], 2), c: T(['b'], 2), d: T([], 2) });
      const first = await go(load, g());
      const next = g();
      next.a = { ...next.a, recipe: 'r2' };
      const second = first.again(next, {}, { out: { a: 'new a' } });
      return { view: view(second.res), calls: second.calls };
    },
  },
  {
    name: 'a rebuilt target with the same output leaves its dependents cached',
    run: async ({ load }) => {
      const g = () => ({ a: T([], 2), b: T(['a'], 2), c: T(['b'], 2) });
      const first = await go(load, g(), {}, { out: { a: 'same' } });
      const next = g();
      next.a = { ...next.a, recipe: 'changed' };
      const second = first.again(next, {}, { out: { a: 'same' } });
      return { view: view(second.res), calls: second.calls, keys: Object.keys(second.res.cache) };
    },
  },
  {
    name: 'early cutoff goes as deep as the outputs stay the same',
    run: async ({ load }) => {
      const g = () => ({ a: T([], 1), b: T(['a'], 1), c: T(['b'], 1), d: T(['c'], 1) });
      const first = await go(load, g(), {}, { out: { a: 'one', b: 'two', c: 'three', d: 'four' } });
      const next = g();
      next.a = { ...next.a, recipe: 'x' };
      const second = first.again(next, {}, { out: { a: 'one', b: 'TWO', c: 'three', d: 'four' } });
      return { view: view(second.res), calls: second.calls };
    },
  },
  {
    name: 'a changed source rebuilds only what depends on it',
    run: async ({ load }) => {
      const g = (text) => ({ s: S(text), t: S('fixed'), a: T(['s'], 2), b: T(['t'], 2), c: T(['a', 'b'], 2) });
      const first = await go(load, g('v1'));
      const second = first.again(g('v2'));
      return { view: view(second.res), calls: second.calls };
    },
  },
  {
    name: 'the reason is recipe before deps before dep',
    run: async ({ load }) => {
      const first = await go(load, { a: T([], 1), b: T([], 1), c: T(['a'], 1), d: T(['a'], 1), e: T(['a'], 1) });
      const second = first.again({ a: T([], 1, { recipe: 'new' }), b: T([], 1), c: T(['a'], 1, { recipe: 'new' }), d: T(['a', 'b'], 1), e: T(['a'], 1) }, {}, { out: { a: 'other' } });
      return view(second.res);
    },
  },
  {
    name: 'the same deps in another order is a deps change',
    run: async ({ load }) => {
      const first = await go(load, { a: T([], 1), b: T([], 1), c: T(['a', 'b'], 1) });
      const second = first.again({ a: T([], 1), b: T([], 1), c: T(['b', 'a'], 1) });
      return view(second.res);
    },
  },
  {
    name: 'the dep reason names the first changed dep in deps order',
    run: async ({ load }) => {
      const g = (ra, rb) => ({ a: T([], 1, { recipe: ra }), b: T([], 1, { recipe: rb }), c: T(['b', 'a'], 1), d: T(['a', 'b'], 1) });
      const first = await go(load, g('1', '1'));
      const second = first.again(g('2', '2'), {}, { out: { a: 'aa', b: 'bb' } });
      const third = first.again(g('2', '1'), {}, { out: { a: 'aa' } });
      return { both: [second.res.targets.c.reason, second.res.targets.d.reason], onlyA: [third.res.targets.c.reason, third.res.targets.d.reason] };
    },
  },
  {
    name: 'a cached target needs no slot and lets its dependents start',
    run: async ({ load }) => {
      const g = (rz) => ({ x: T([], 9), y: T([], 5), z: T(['y'], 1, { recipe: rz }) });
      const first = await go(load, g('r'));
      const second = first.again({ ...g('other'), x: T([], 9, { recipe: 'x2' }), y: T([], 5) }, { slots: 1 }, { out: { x: 'xx' } });
      return { view: view(second.res), order: second.res.startOrder };
    },
  },
  {
    name: 'run gets the output of a cached dep from the cache entry',
    run: async ({ load }) => {
      const first = await go(load, { a: T([], 1), b: T(['a'], 1) }, {}, { out: { a: 'cached output of a' } });
      const seen = [];
      const second = first.build({ a: T([], 1), b: T(['a'], 1, { recipe: 'v2' }) }, { cache: first.res.cache, run: (name, info) => { seen.push([name, info.deps]); return { ok: true, output: 'b2' }; } });
      return { seen, view: view(second) };
    },
  },
  {
    name: 'a failed target skips what depends on it and independent targets still build',
    run: async ({ load }) => {
      const { res } = await go(load, { a: T([], 2), b: T(['a'], 2), c: T(['b'], 2), d: T(['a'], 2), e: T([], 2) }, { slots: 2 }, { fail: ['b'] });
      return { view: view(res), ok: res.ok, stats: res.stats, error: res.targets.b.error };
    },
  },
  {
    name: 'the cause of a skipped target is the failed target at the root',
    run: async ({ load }) => {
      const { res } = await go(load, { a: T([], 1), b: T(['a'], 1), c: T(['b'], 1), d: T(['c', 'a'], 1) }, {}, { fail: ['a'] });
      return Object.fromEntries(Object.entries(res.targets).map(([k, v]) => [k, v.cause ?? null]));
    },
  },
  {
    name: 'with two bad deps the cause follows the deps order, not the time',
    run: async ({ load }) => {
      const g = (deps) => ({ slow: T([], 9), quick: T([], 1), top: T(deps, 1), alone: T(['top'], 1) });
      const one = await go(load, g(['slow', 'quick']), { slots: 2 }, { fail: ['slow', 'quick'] });
      const two = await go(load, g(['quick', 'slow']), { slots: 2 }, { fail: ['slow', 'quick'] });
      return { one: [one.res.targets.top.cause, one.res.targets.alone.cause], two: [two.res.targets.top.cause, two.res.targets.alone.cause] };
    },
  },
  {
    name: 'a skipped target waits for the other deps to be decided and has no start',
    run: async ({ load }) => {
      const { res } = await go(load, { slow: T([], 9), quick: T([], 1), top: T(['quick', 'slow'], 1) }, { slots: 2 }, { fail: ['quick'] });
      return { view: view(res), makespan: res.makespan, order: res.startOrder };
    },
  },
  {
    name: 'a thrown error is a failure with the message',
    run: async ({ load }) => {
      const { res, calls } = await go(load, { a: T(), b: T(['a']) }, {}, { boom: ['a'] });
      return { view: view(res), error: res.targets.a.error, calls };
    },
  },
  {
    name: 'a result that is not ok true with a string or ok false is a failure',
    run: async ({ load }) => {
      const junk = { a: { ok: true, output: 5 }, b: undefined, c: 'text', d: { ok: false }, e: { ok: false, error: 12 }, f: { output: 'x' } };
      const { res } = await go(load, { a: T(), b: T(), c: T(), d: T(), e: T(), f: T() }, {}, { junk });
      return Object.fromEntries(Object.entries(res.targets).map(([k, v]) => [k, v.error]));
    },
  },
  {
    name: 'a retry runs again at once in the same slot and costs again',
    run: async ({ load }) => {
      const { res, calls } = await go(load, { a: T([], 4, { retries: 2 }), b: T([], 3), c: T(['a'], 1) }, { slots: 2 }, { until: { a: 2 } });
      return { view: view(res), calls, makespan: res.makespan };
    },
  },
  {
    name: 'a target that fails every attempt has retries plus one attempts',
    run: async ({ load }) => {
      const { res, calls } = await go(load, { a: T([], 5, { retries: 2 }), b: T(['a'], 1) }, {}, { fail: ['a'] });
      return { view: view(res), calls, makespan: res.makespan, error: res.targets.a.error };
    },
  },
  {
    name: 'a retry keeps the slot, so waiting targets cannot use it',
    run: async ({ load }) => {
      const { res } = await go(load, { a: T([], 2, { retries: 1 }), b: T([], 3), c: T([], 1) }, { slots: 1 }, { until: { a: 1 } });
      return { view: view(res), order: res.startOrder };
    },
  },
  {
    name: 'with keepGoing false nothing starts after a failure and the rest is skipped',
    run: async ({ load }) => {
      const { res, calls } = await go(load, { a: T([], 2), b: T([], 6), c: T(['a'], 2), d: T(['b'], 1), e: T([], 1) }, { slots: 2, keepGoing: false }, { fail: ['a'] });
      return { view: view(res), calls, makespan: res.makespan, ok: res.ok, stats: res.stats };
    },
  },
  {
    name: 'with keepGoing false a running job finishes and keeps its status',
    run: async ({ load }) => {
      const { res } = await go(load, { a: T([], 2), b: T([], 6), d: T(['b'], 1), e: T(['a'], 1) }, { slots: 2, keepGoing: false }, { fail: ['a'] });
      return { view: view(res), cache: Object.keys(res.cache) };
    },
  },
  {
    name: 'with keepGoing false a cached target that was not decided is skipped too',
    run: async ({ load }) => {
      const g = (ra, rx) => ({ a: T([], 2, { recipe: ra }), x: T([], 6, { recipe: rx }), y: T(['x'], 1), z: T([], 1) });
      const first = await go(load, g('1', '1'), {}, { out: { x: 'same' } });
      const second = first.again(g('2', '2'), { keepGoing: false, slots: 2 }, { fail: ['a'], out: { x: 'same' } });
      return view(second.res);
    },
  },
  {
    name: 'with keepGoing false the stop cause is the first failure in name order of those that end together',
    run: async ({ load }) => {
      const { res } = await go(load, { m: T([], 3), b: T([], 3), t: T(['m'], 1), u: T([], 3) }, { slots: 3, keepGoing: false }, { fail: ['m', 'b'] });
      return Object.fromEntries(Object.entries(res.targets).map(([k, v]) => [k, v.status + (v.cause ? `:${v.cause}` : '')]));
    },
  },
  {
    name: 'with keepGoing false the result does not depend on the name order of jobs that end together',
    run: async ({ load }) => {
      const g = (first, second) => ({ [first]: T([], 3), [second]: T([], 3), dep: T([first], 0), gone: T([second], 1) });
      const out = [];
      for (const [x, y] of [['a', 'b'], ['b', 'a']]) {
        const base = await go(load, g(x, y));
        const again = base.again({ ...g(x, y), [x]: T([], 3, { recipe: 'n' }), [y]: T([], 3, { recipe: 'n' }) }, { slots: 2, keepGoing: false }, { fail: ['b'] });
        out.push(view(again.res));
      }
      return out;
    },
  },
  {
    name: 'with keepGoing false a running job still retries after the stop',
    run: async ({ load }) => {
      const { res, calls } = await go(load, { a: T([], 1), b: T([], 4, { retries: 1 }), c: T(['b'], 1) }, { slots: 2, keepGoing: false }, { fail: ['a'], until: { b: 1 } });
      return { view: view(res), calls };
    },
  },
  {
    name: 'failed and skipped targets and sources have no cache entry',
    run: async ({ load }) => {
      const first = await go(load, { s: S('s'), a: T(['s']), b: T(['a']), c: T(['b']), d: T([]) });
      const second = first.again({ s: S('s'), a: T(['s'], 1, { recipe: 'new' }), b: T(['a']), c: T(['b']), d: T([]) }, {}, { fail: ['a'] });
      return { keys: Object.keys(second.res.cache), first: Object.keys(first.res.cache) };
    },
  },
  {
    name: 'a build does not change its graph or its cache',
    run: async ({ load }) => {
      const first = await go(load, { a: T([], 1), b: T(['a'], 1) });
      const graph = { a: T([], 1, { recipe: 'q' }), b: T(['a'], 1), c: T([], 1) };
      const copy = JSON.stringify(graph);
      const before = JSON.stringify(first.res.cache);
      const second = first.again(graph);
      return { graph: JSON.stringify(graph) === copy, cache: JSON.stringify(first.res.cache) === before, fresh: second.res.cache !== first.res.cache };
    },
  },
  {
    name: 'entries outside the goals are kept and entries of unknown names are dropped',
    run: async ({ load }) => {
      const first = await go(load, { a: T(), b: T(['a']), c: T(), d: T(['c']), s: S('x') });
      const cache = { ...first.res.cache, gone: { recipe: 'h', deps: [], output: 'o' }, s: { recipe: 'h', deps: [], output: 'o' } };
      const second = first.build({ a: T(), b: T(['a'], 1, { recipe: 'new' }), c: T(), d: T(['c']), s: S('x') }, { run: runner().run, cache, goals: ['b'] });
      return { keys: Object.keys(second.cache), view: view(second) };
    },
  },
  {
    name: 'goals build only their closure',
    run: async ({ load }) => {
      const { res, calls } = await go(load, { s: S('s'), a: T(['s'], 3), b: T(['a'], 2), c: T(['s'], 9), d: T(['c'], 1), e: T() }, { goals: ['b', 'a'], slots: 2 });
      return { view: view(res), calls, makespan: res.makespan, stats: res.stats };
    },
  },
  {
    name: 'weights are computed inside the closure only',
    run: async ({ load }) => {
      const { res } = await go(load, { a: T([], 3), b: T([], 1), big: T(['b'], 50), c: T(['a'], 1) }, { goals: ['a', 'b', 'c'] });
      return res.startOrder;
    },
  },
  {
    name: 'a goal that is not in the graph is an error, also with goals not an array',
    run: async ({ load }) => {
      const { build } = await lib(load);
      const run = runner().run;
      return [caught(() => build({ a: T() }, { run, goals: ['a', 'nope', 'zip'] })), caught(() => build({ a: T() }, { run, goals: 'a' })), caught(() => build({ a: T() }, { run, goals: [] }))];
    },
  },
  {
    name: 'an unknown dep names the target and the first unknown dep',
    run: async ({ load }) => {
      const { build } = await lib(load);
      const run = runner().run;
      return [caught(() => build({ b: T(['a', 'x', 'y']), a: T(), c: T(['q']) }, { run })), caught(() => build({ a: T(['z']), b: T(['y']) }, { run }))];
    },
  },
  {
    name: 'a dep listed twice is an error',
    run: async ({ load }) => {
      const { build } = await lib(load);
      return caught(() => build({ a: T(), b: T(['a', 'a']) }, { run: runner().run }));
    },
  },
  {
    name: 'a bad definition is an error naming the target',
    run: async ({ load }) => {
      const { build } = await lib(load);
      const run = runner().run;
      const cases = [{ a: null }, { a: { recipe: 3 } }, { a: { source: 5 } }, { a: { source: 's', deps: [] } }, { a: { recipe: 'r', cost: -1 } }, { a: { recipe: 'r', cost: 1.5 } }, { a: { recipe: 'r', retries: 'x' } }, { a: { recipe: 'r', deps: 'b' } }, { a: { recipe: 'r', deps: [1] } }, { a: { recipe: 'r' } }];
      return cases.map((graph) => caught(() => build(graph, { run })));
    },
  },
  {
    name: 'validation order is bad target, duplicate dep, unknown dep, then cycle, then goals',
    run: async ({ load }) => {
      const { build } = await lib(load);
      const run = runner().run;
      return [
        caught(() => build({ a: T(['b', 'b', 'zz']), b: T(['a']), c: { recipe: 1 } }, { run })),
        caught(() => build({ a: T(['b']), b: T(['a']), c: T(['zz']) }, { run })),
        caught(() => build({ a: T(['b']), b: T(['a']) }, { run, goals: ['nope'] })),
        caught(() => build({ a: T(['zz', 'b', 'b']), b: T() }, { run })),
        caught(() => build({ a: { recipe: 'r', deps: ['b', 'b'], cost: -1 }, b: T() }, { run })),
        caught(() => build({ a: T(['b']), b: T(['a']), c: T() }, { run, goals: ['c'] })),
      ];
    },
  },
  {
    name: 'a cycle path starts at the smallest name on a cycle and ends there',
    run: async ({ load }) => {
      const { build } = await lib(load);
      const run = runner().run;
      return [
        caught(() => build({ b: T(['c']), c: T(['b']), a: T(['b']) }, { run })),
        caught(() => build({ x: T(['x']) }, { run })),
        caught(() => build({ m: T(['n']), n: T(['o']), o: T(['m']), z: T(['m']) }, { run })),
        caught(() => build({ a: T(['b']), b: T(['c']), c: T(['d']), d: T(['b']) }, { run })),
      ];
    },
  },
  {
    name: 'the cycle path is the shortest cycle, and the smallest names among equal ones',
    run: async ({ load }) => {
      const { build } = await lib(load);
      const run = runner().run;
      return [
        caught(() => build({ a: T(['b', 'c']), b: T(['d']), c: T(['a']), d: T(['a']) }, { run })),
        caught(() => build({ a: T(['d', 'b']), b: T(['c']), c: T(['a']), d: T(['e']), e: T(['f']), f: T(['a']) }, { run })),
        caught(() => build({ a: T(['c', 'b']), b: T(['a']), c: T(['a']) }, { run })),
        caught(() => build({ a: T(['b']), b: T(['a', 'c']), c: T(['b']) }, { run })),
        caught(() => build({ a: T(['b', 'c']), b: T(['c']), c: T(['b', 'a']) }, { run })),
        caught(() => build({ a: T(['c', 'b']), b: T(['d']), c: T(['d']), d: T(['a']) }, { run })),
      ];
    },
  },
  {
    name: 'slots and run are checked before the graph',
    run: async ({ load }) => {
      const { build } = await lib(load);
      const run = runner().run;
      const kind = (fn) => caught(fn);
      return [kind(() => build({ a: T() }, { run, slots: 0 })), kind(() => build({ a: T() }, { run, slots: 1.5 })), kind(() => build({ a: T() }, { run, slots: '2' })), kind(() => build({ a: T() }, {})), kind(() => build({ a: T(['q']) }, { slots: 0, run })), kind(() => build({ a: T(['q']) }, { slots: 2 })), kind(() => build({}, { run }))];
    },
  },
  {
    name: 'an entry of the wrong shape counts as new',
    run: async ({ load }) => {
      const g = { a: T(), b: T(), c: T(), d: T(), e: T() };
      const first = await go(load, g);
      const cache = { ...first.res.cache, a: 'text', b: { ...first.res.cache.b, output: 5 }, c: { ...first.res.cache.c, deps: 'x' }, d: { ...first.res.cache.d, recipe: undefined }, e: { ...first.res.cache.e, deps: [['a']] } };
      const second = first.build(g, { cache, run: runner().run });
      return view(second);
    },
  },
  {
    name: 'an empty graph builds to an empty result',
    run: async ({ load }) => {
      const { res } = await go(load, {});
      return res;
    },
  },
  {
    name: 'a target without cost costs one and without deps has none',
    run: async ({ load }) => {
      const { res } = await go(load, { a: { recipe: 'x' }, b: { recipe: 'y', deps: ['a'] } });
      return { view: view(res), makespan: res.makespan };
    },
  },
  {
    name: 'a long chain and a wide graph finish fast',
    run: async ({ load }) => {
      const { build } = await lib(load);
      const run = (name) => ({ ok: true, output: name });
      const chain = {};
      for (let i = 0; i < 2500; i += 1) chain[`t${String(i).padStart(5, '0')}`] = T(i ? [`t${String(i - 1).padStart(5, '0')}`] : [], 1);
      const wide = { sink: T([], 2) };
      const names = [];
      for (let i = 0; i < 1500; i += 1) {
        names.push(`w${i}`);
        wide[`w${i}`] = T([], (i % 7) + 1);
      }
      wide.sink = T(names, 2);
      const t0 = cpuMs();
      const a = build(chain, { run, slots: 3 });
      const b = build(wide, { run, slots: 8 });
      const second = build(wide, { run, slots: 8, cache: b.cache });
      return { chain: [a.makespan, a.startOrder.length, a.ok], wide: [b.makespan, b.startOrder.length, b.startOrder.slice(0, 9), b.stats], again: [second.makespan, second.stats], fast: cpuMs() - t0 < 3000 };
    },
  },
];
