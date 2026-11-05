function unionIntervals(list) {
  const items = [];
  for (const text of list) {
    const m = /^([\[(])(-?\d+),(-?\d+)([\])])$/.exec(text);
    const lo = Number(m[2]);
    const hi = Number(m[3]);
    if (lo > hi) continue;
    items.push({ lo, hi, loClosed: m[1] === '[', hiClosed: m[4] === ']' });
  }
  items.sort((a, b) => a.lo - b.lo);
  const merged = [];
  for (const item of items) {
    const cur = merged[merged.length - 1];
    if (cur && item.lo <= cur.hi) {
      if (item.hi > cur.hi) {
        cur.hi = item.hi;
        cur.hiClosed = item.hiClosed;
      }
    } else {
      merged.push({ ...item });
    }
  }
  return merged.map((x) => (x.loClosed ? '[' : '(') + x.lo + ',' + x.hi + (x.hiClosed ? ']' : ')'));
}
