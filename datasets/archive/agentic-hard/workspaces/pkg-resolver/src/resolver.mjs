import { ConflictError, CycleError } from './errors.mjs';
import { maxSatisfying } from './range.mjs';

// resolve({ a: '^1.0.0' }, registry) -> { a: '1.4.2', b: '2.0.0', ... }
// Walks the graph from the project's dependencies. Each package gets one
// version: the highest one that matches the first range that asks for it.
export function resolve(rootDeps, registry) {
  const chosen = {};
  const visiting = [];

  function visit(name, range, from) {
    const version = maxSatisfying(registry.versions(name), range);
    if (version === null) throw new ConflictError(name, [{ range, from }]);
    if (visiting.includes(name)) throw new CycleError([name]);
    if (name in chosen) return;
    chosen[name] = version;
    visiting.push(name);
    for (const [dep, depRange] of Object.entries(registry.dependencies(name, version))) visit(dep, depRange, `${name}@${version}`);
    visiting.pop();
  }

  for (const [name, range] of Object.entries(rootDeps)) visit(name, range, 'root');
  return Object.fromEntries(Object.entries(chosen).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
