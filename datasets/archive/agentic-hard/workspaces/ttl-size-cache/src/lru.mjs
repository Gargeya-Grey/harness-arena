// Recency order of keys: the first key is the least recently used.
export class Recency {
  constructor() {
    this.order = new Set();
  }

  touch(key) {
    this.order.delete(key);
    this.order.add(key);
  }

  forget(key) {
    this.order.delete(key);
  }

  oldest() {
    for (const key of this.order) return key;
    return undefined;
  }

  keys() {
    return [...this.order];
  }

  clear() {
    this.order.clear();
  }
}
