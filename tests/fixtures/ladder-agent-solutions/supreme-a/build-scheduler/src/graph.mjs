import { GraphError } from './errors.mjs';

const isCount = (value) => Number.isInteger(value) && value >= 0;
const bad = (target, why) => new GraphError('bad-target', `${target}: ${why}`, { target });

function checkTarget(graph, name) {
  const def = graph[name];
  if (def === null || typeof def !== 'object' || Array.isArray(def)) throw bad(name, 'definition must be an object');
  if ('source' in def) {
    if (typeof def.source !== 'string' || Object.keys(def).length !== 1) throw bad(name, 'a source has only a source string');
    return;
  }
  if (typeof def.recipe !== 'string') throw bad(name, 'recipe must be a string');
  if (def.deps !== undefined && !(Array.isArray(def.deps) && def.deps.every((dep) => typeof dep === 'string'))) throw bad(name, 'deps must be strings');
  if (def.cost !== undefined && !isCount(def.cost)) throw bad(name, 'cost must be an integer >= 0');
  if (def.retries !== undefined && !isCount(def.retries)) throw bad(name, 'retries must be an integer >= 0');
  const seen = new Set();
  for (const dep of def.deps || []) {
    if (seen.has(dep)) throw new GraphError('dup-dep', `${name}: ${dep} twice`, { target: name, dep });
    seen.add(dep);
  }
  for (const dep of def.deps || []) {
    if (!Object.hasOwn(graph, dep)) throw new GraphError('unknown-dep', `${name}: unknown ${dep}`, { target: name, dep });
  }
}

/** The shortest cycle through `start`, smallest names first, as [start, ..., start]. */
function cycleThrough(start, depsOf) {
  const dependents = new Map();
  for (const [name, deps] of depsOf) for (const dep of deps) (dependents.get(dep) || dependents.set(dep, []).get(dep)).push(name);
  const dist = new Map([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i += 1) {
    for (const prev of dependents.get(queue[i]) || []) {
      if (!dist.has(prev)) {
        dist.set(prev, dist.get(queue[i]) + 1);
        queue.push(prev);
      }
    }
  }
  // dist(x): length of the shortest dep path from x to start. For start itself the cycle is 1 + min over its deps.
  let length = Infinity;
  for (const dep of depsOf.get(start)) if (dist.has(dep)) length = Math.min(length, 1 + dist.get(dep));
  const path = [start];
  let at = start;
  for (let left = length; left > 0; left -= 1) {
    const next = [...depsOf.get(at)].sort().find((dep) => dist.get(dep) === left - 1);
    path.push(next);
    at = next;
  }
  return path;
}

function reaches(from, target, depsOf) {
  const seen = new Set();
  const stack = [...depsOf.get(from)];
  while (stack.length) {
    const name = stack.pop();
    if (name === target) return true;
    if (seen.has(name)) continue;
    seen.add(name);
    stack.push(...depsOf.get(name));
  }
  return false;
}

export function analyze(graph, goals) {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) throw new GraphError('bad-target', 'graph must be an object', { target: undefined });
  const names = Object.keys(graph).sort();
  for (const name of names) checkTarget(graph, name);
  const depsOf = new Map(names.map((name) => [name, graph[name].deps || []]));

  // Kahn: deps before dependents.
  const waiting = new Map(names.map((name) => [name, depsOf.get(name).length]));
  const dependents = new Map(names.map((name) => [name, []]));
  for (const name of names) for (const dep of depsOf.get(name)) dependents.get(dep).push(name);
  const topo = names.filter((name) => waiting.get(name) === 0);
  for (let i = 0; i < topo.length; i += 1) {
    for (const next of dependents.get(topo[i])) {
      waiting.set(next, waiting.get(next) - 1);
      if (waiting.get(next) === 0) topo.push(next);
    }
  }
  if (topo.length < names.length) {
    const stuck = names.filter((name) => waiting.get(name) > 0);
    const start = stuck.find((name) => reaches(name, name, depsOf));
    throw new GraphError('cycle', 'dependency cycle', { path: cycleThrough(start, depsOf) });
  }

  let wanted = names;
  if (goals !== null) {
    if (!Array.isArray(goals) || !goals.every((goal) => typeof goal === 'string')) throw new GraphError('bad-target', 'goals must be names', { target: undefined });
    for (const goal of goals) if (!Object.hasOwn(graph, goal)) throw new GraphError('no-goal', `no target ${goal}`, { target: goal });
    const inside = new Set();
    const stack = [...goals];
    while (stack.length) {
      const name = stack.pop();
      if (inside.has(name)) continue;
      inside.add(name);
      stack.push(...depsOf.get(name));
    }
    wanted = names.filter((name) => inside.has(name));
  }
  const closure = new Set(wanted);

  const nodes = new Map();
  for (const name of wanted) {
    const def = graph[name];
    nodes.set(name, { name, source: def.source, recipe: def.recipe, deps: depsOf.get(name), cost: def.source === undefined ? def.cost ?? 1 : 0, retries: def.retries ?? 0, weight: 0 });
  }
  const below = new Map();
  for (const name of [...topo].reverse()) {
    if (!closure.has(name)) continue;
    const node = nodes.get(name);
    node.weight = node.cost + (below.get(name) ?? 0);
    for (const dep of node.deps) below.set(dep, Math.max(below.get(dep) ?? 0, node.weight));
  }
  return { nodes, closure: wanted, built: new Set(names.filter((name) => graph[name].source === undefined)) };
}
