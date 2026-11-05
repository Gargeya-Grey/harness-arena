function sortRecords(records, keys) {
  const specs = keys.map((k) => (k.startsWith('-') ? { field: k.slice(1), dir: -1 } : { field: k, dir: 1 }));
  const missing = (v) => v === undefined || v === null;
  return records
    .map((record, index) => ({ record, index }))
    .sort((p, q) => {
      for (const { field, dir } of specs) {
        const a = p.record[field];
        const b = q.record[field];
        if (missing(a) && missing(b)) continue;
        if (missing(a)) return 1;
        if (missing(b)) return -1;
        if (a < b) return -dir;
        if (a > b) return dir;
      }
      return p.index - q.index;
    })
    .map((item) => item.record);
}
