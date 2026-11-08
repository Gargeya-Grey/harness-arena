// Cache entries and the reason a target is stale. See SPEC.md, "Staleness and the cache".

/** The reason a built target must run, or null when its entry is up to date. */
export function staleReason(node, entry, depHashes) {
  throw new Error('not implemented');
}

/** The cache entry of a target that has just been built. */
export function makeEntry(node, depHashes, output) {
  throw new Error('not implemented');
}
