// A lockfile is JSON with the packages sorted by name, so it diffs well.
export function toLockfile(resolution, registry) {
  const packages = {};
  for (const name of Object.keys(resolution).sort()) {
    const version = resolution[name];
    const requires = registry.dependencies(name, version);
    packages[name] = {
      version,
      requires: Object.fromEntries(Object.keys(requires).sort().map((dep) => [dep, requires[dep]])),
    };
  }
  return `${JSON.stringify({ lockfileVersion: 1, packages }, null, 2)}\n`;
}

export function fromLockfile(text) {
  const data = JSON.parse(text);
  if (data.lockfileVersion !== 1) throw new Error('unsupported lockfile version');
  return Object.fromEntries(Object.entries(data.packages).map(([name, entry]) => [name, entry.version]));
}
