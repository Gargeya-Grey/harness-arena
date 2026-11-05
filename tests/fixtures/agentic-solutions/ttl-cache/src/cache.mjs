// A small in-memory cache. An entry can expire after a time to live.
export class Cache {
  constructor({ ttlMs = Infinity, now = Date.now } = {}) {
    this.entries = new Map();
    this.ttlMs = ttlMs;
    this.now = now;
  }

  set(key, value, ttlMs = this.ttlMs) {
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    return this;
  }

  live(key) {
    const entry = this.entries.get(key);
    return entry !== undefined && this.now() < entry.expiresAt ? entry : undefined;
  }

  get(key) {
    const entry = this.live(key);
    if (!entry) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key) {
    return this.live(key) !== undefined;
  }

  delete(key) {
    return this.entries.delete(key);
  }

  size() {
    let count = 0;
    for (const key of this.entries.keys()) if (this.live(key)) count += 1;
    return count;
  }

  purge() {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (!this.live(key)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
