// hits and misses count get() calls. evictions count entries removed to make
// room. expirations count entries removed because their time was up.
export class Stats {
  constructor() {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.expirations = 0;
  }

  snapshot() {
    return { hits: this.hits, misses: this.misses, evictions: this.evictions, expirations: this.expirations };
  }
}
