import { NotFoundError } from './errors.mjs';

// An in-memory registry: { name: { '1.0.0': { dependencyName: 'range' } } }
export class Registry {
  constructor(packages = {}) {
    this.packages = packages;
  }

  has(name) {
    return Object.hasOwn(this.packages, name);
  }

  // Every published version, in no particular order.
  versions(name) {
    if (!this.has(name)) throw new NotFoundError(name);
    return Object.keys(this.packages[name]);
  }

  dependencies(name, version) {
    if (!this.has(name) || !Object.hasOwn(this.packages[name], version)) throw new NotFoundError(`${name}@${version}`);
    return { ...this.packages[name][version] };
  }
}
