export class ResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

// The package is not in the registry.
export class NotFoundError extends ResolutionError {
  constructor(pkg) {
    super(`package not found: ${pkg}`);
    this.pkg = pkg;
  }
}

// No version of `pkg` satisfies every requirement on it.
// `requirements` is a list of { range, from }; `from` is 'root' for the
// project's own dependencies, otherwise 'name@version' of the requiring package.
export class ConflictError extends ResolutionError {
  constructor(pkg, requirements) {
    super(`no version of ${pkg} satisfies ${requirements.map((r) => `${r.range} (from ${r.from})`).join(' and ')}`);
    this.pkg = pkg;
    this.requirements = requirements;
  }
}

// `path` lists the packages of the cycle in order. The last entry repeats the
// first one: ['a', 'b', 'a'].
export class CycleError extends ResolutionError {
  constructor(path) {
    super(`dependency cycle: ${path.join(' -> ')}`);
    this.path = path;
  }
}
