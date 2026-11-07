import { normalize } from './config.mjs';
import { parseDuration } from './duration.mjs';
import { expiresAtFor, isExpired } from './expiry.mjs';
import { Recency } from './lru.mjs';
import { Stats } from './stats.mjs';

// A cache with a time to live, a size limit and least-recently-used eviction.
//   new Cache({ ttl: '30s', maxEntries: 100, maxBytes: 1e6, sizeOf, clock })
//   set(key, value, { ttl }), get(key), peek(key), has(key), delete(key), ttlOf(key),
//   purge(), size(), bytes(), keys(), stats(), clear()
export class Cache {
  #config;
  #entries = new Map();
  #recency = new Recency();
  #stats = new Stats();
  #bytes = 0;

  constructor(options = {}) {
    this.#config = normalize(options);
  }

  #now() {
    return this.#config.clock.now();
  }

  #remove(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#recency.forget(key);
    this.#bytes -= entry.size;
    return entry;
  }

  #expire(key) {
    this.#remove(key);
    this.#stats.expirations += 1;
  }

  #purge(now) {
    let removed = 0;
    for (const [key, entry] of [...this.#entries]) {
      if (isExpired(entry, now)) {
        this.#expire(key);
        removed += 1;
      }
    }
    return removed;
  }

  #live(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (isExpired(entry, this.#now())) {
      this.#expire(key);
      return undefined;
    }
    return entry;
  }

  set(key, value, options = {}) {
    const now = this.#now();
    const ttlMs = options.ttl === undefined ? this.#config.ttlMs : parseDuration(options.ttl);
    const size = this.#config.sizeOf(value);
    this.#entries.set(key, { value, size, expiresAt: expiresAtFor(now, ttlMs) });
    this.#recency.touch(key);
    this.#bytes += size;
    while (this.#entries.size > 0 && (this.#entries.size > this.#config.maxEntries || this.#bytes > this.#config.maxBytes)) {
      this.#remove(this.#recency.oldest());
      this.#stats.evictions += 1;
    }
    return true;
  }

  get(key) {
    const entry = this.#live(key);
    if (!entry) {
      this.#stats.misses += 1;
      return undefined;
    }
    this.#recency.touch(key);
    this.#stats.hits += 1;
    return entry.value;
  }

  peek(key) {
    return this.get(key);
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.#live(key) !== undefined && this.#remove(key) !== undefined;
  }

  clear() {
    this.#entries.clear();
    this.#recency.clear();
    this.#bytes = 0;
  }

  // Seconds left for the key: Infinity when it never expires, undefined when it is not there.
  ttlOf(key) {
    const entry = this.#live(key);
    return entry ? Math.ceil((entry.expiresAt - this.#now()) / 1000) : undefined;
  }

  // Removes the expired entries; returns how many it removed.
  purge() {
    return this.#purge(this.#now());
  }

  size() {
    return this.#entries.size;
  }

  bytes() {
    return this.#bytes;
  }

  // Keys from least to most recently used.
  keys() {
    return this.#recency.keys();
  }

  stats() {
    return { ...this.#stats.snapshot(), entries: this.size(), bytes: this.bytes() };
  }
}
