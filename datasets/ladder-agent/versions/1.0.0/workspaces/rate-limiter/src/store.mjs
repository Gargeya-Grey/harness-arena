// Holds one entry per id.
export function createStore() {
  const entries = new Map();
  return {
    get: (id) => entries.get(id),
    set(id, entry) {
      entries.set(id, entry);
    },
    delete: (id) => entries.delete(id),
    size: () => entries.size,
  };
}
