// Prints the resolved graph as an indented tree. A package that was printed
// already is shown again without its children, marked with (*).
export function renderTree(rootDeps, resolution, registry) {
  const lines = [];
  const seen = new Set();
  const walk = (names, depth) => {
    for (const name of [...names].sort()) {
      const version = resolution[name];
      const repeated = seen.has(name);
      lines.push(`${'  '.repeat(depth)}${name}@${version}${repeated ? ' (*)' : ''}`);
      if (repeated) continue;
      seen.add(name);
      walk(Object.keys(registry.dependencies(name, version)), depth + 1);
    }
  };
  walk(Object.keys(rootDeps), 0);
  return lines.join('\n');
}
