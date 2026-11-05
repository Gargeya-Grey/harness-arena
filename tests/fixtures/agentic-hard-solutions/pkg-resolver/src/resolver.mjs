import { ConflictError, CycleError } from './errors.mjs';
import { satisfies } from './range.mjs';
import { compare, valid } from './semver.mjs';

const byName = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

function findCycle(chosen, registry, rootNames) {
  const state = new Map();
  const stack = [];
  const visit = (name) => {
    if (state.get(name) === 'done') return null;
    if (state.get(name) === 'active') return [...stack.slice(stack.indexOf(name)), name];
    state.set(name, 'active');
    stack.push(name);
    for (const dep of Object.keys(registry.dependencies(name, chosen.get(name))).sort()) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(name, 'done');
    return null;
  };
  for (const name of [...rootNames].sort()) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return null;
}

// One version per package. Prefers the highest version of each package, and
// goes back to a lower version when a later requirement rules the higher out.
function solve(chosen, requirements, queue, registry) {
  if (queue.length === 0) return chosen;
  const [name, ...rest] = queue;
  const needs = requirements.get(name);
  const candidates = registry
    .versions(name)
    .filter(valid)
    .sort((a, b) => compare(b, a))
    .filter((version) => needs.every((need) => satisfies(version, need.range)));
  if (candidates.length === 0) throw new ConflictError(name, needs);
  let failure = null;
  for (const version of candidates) {
    const nextChosen = new Map(chosen).set(name, version);
    const nextNeeds = new Map(requirements);
    const nextQueue = [...rest];
    let clash = null;
    for (const [dep, range] of Object.entries(registry.dependencies(name, version)).sort(byName)) {
      const list = [...(nextNeeds.get(dep) ?? []), { range, from: `${name}@${version}` }];
      nextNeeds.set(dep, list);
      if (nextChosen.has(dep)) {
        if (!satisfies(nextChosen.get(dep), range)) clash = new ConflictError(dep, list);
      } else if (!nextQueue.includes(dep)) nextQueue.push(dep);
      if (clash) break;
    }
    if (clash) {
      failure = clash;
      continue;
    }
    try {
      return solve(nextChosen, nextNeeds, nextQueue, registry);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      failure = error;
    }
  }
  throw failure;
}

// resolve({ a: '^1.0.0' }, registry) -> { a: '1.4.2', b: '2.0.0', ... }
export function resolve(rootDeps, registry) {
  const requirements = new Map();
  const queue = [];
  for (const [name, range] of Object.entries(rootDeps)) {
    requirements.set(name, [{ range, from: 'root' }]);
    queue.push(name);
  }
  const chosen = solve(new Map(), requirements, queue, registry);
  const cycle = findCycle(chosen, registry, Object.keys(rootDeps));
  if (cycle) throw new CycleError(cycle);
  return Object.fromEntries([...chosen].sort(byName));
}
