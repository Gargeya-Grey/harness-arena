// A small in-memory cache. Entries stay until they are deleted.
export class Cache {
  constructor() {
    this.entries = new Map();
  }

  set(key, value) {
    this.entries.set(key, value);
    return this;
  }

  get(key) {
    return this.entries.get(key);
  }

  has(key) {
    return this.entries.has(key);
  }

  delete(key) {
    return this.entries.delete(key);
  }

  size() {
    return this.entries.size;
  }
}
