// Holds one entry per key, least recently used first. At most maxKeys entries.
export function createStore({ maxKeys = Infinity } = {}) {
  if (!(maxKeys >= 1)) throw new RangeError('maxKeys must be at least 1');
  const entries = new Map();
  return {
    get: (key) => entries.get(key),
    set(key, entry) {
      entries.set(key, entry);
    },
    // Marks the key as the most recently used.
    touch(key) {
      const entry = entries.get(key);
      entries.delete(key);
      entries.set(key, entry);
    },
    delete: (key) => entries.delete(key),
    size: () => entries.size,
    // Makes room for one more key. An entry that `isFull` is as good as new, so
    // dropping it loses nothing; those go first, then the least recently used.
    makeRoom(isFull) {
      if (entries.size < maxKeys) return;
      for (const [key, entry] of [...entries]) if (isFull(entry)) entries.delete(key);
      for (const key of entries.keys()) {
        if (entries.size < maxKeys) break;
        entries.delete(key);
      }
    },
  };
}
