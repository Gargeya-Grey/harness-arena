function simulateCache(capacity, ttl, ops) {
  const map = new Map();
  const out = [];
  for (const op of ops) {
    const time = op[1];
    for (const [key, entry] of map) {
      if (time - entry.wrote >= ttl) map.delete(key);
    }
    if (op[0] === 'put') {
      const key = op[2];
      if (map.has(key)) map.delete(key);
      map.set(key, { value: op[3], wrote: time });
      if (map.size > capacity) map.delete(map.keys().next().value);
      out.push(null);
    } else if (op[0] === 'get') {
      const entry = map.get(op[2]);
      if (entry) {
        map.delete(op[2]);
        entry.wrote = time;
        map.set(op[2], entry);
        out.push(entry.value);
      } else {
        out.push(null);
      }
    } else {
      out.push(map.size);
    }
  }
  return out;
}
