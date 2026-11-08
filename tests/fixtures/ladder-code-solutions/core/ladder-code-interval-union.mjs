function unionIntervals(list) {
  const items = [];
  for (const text of list) {
    const m = /^([\[(])(-?\d+),(-?\d+)([\])])$/.exec(text);
    const lo = Number(m[2]);
    const hi = Number(m[3]);
    const loClosed = m[1] === '[';
    const hiClosed = m[4] === ']';
    if (lo > hi || (lo === hi && !(loClosed && hiClosed))) continue;
    items.push({ lo, hi, loClosed, hiClosed });
  }
  items.sort((a, b) => a.lo - b.lo || (a.loClosed === b.loClosed ? 0 : a.loClosed ? -1 : 1));
  const merged = [];
  for (const item of items) {
    const cur = merged[merged.length - 1];
    if (cur && (item.lo < cur.hi || (item.lo === cur.hi && (cur.hiClosed || item.loClosed)))) {
      if (item.hi > cur.hi) {
        cur.hi = item.hi;
        cur.hiClosed = item.hiClosed;
      } else if (item.hi === cur.hi) {
        cur.hiClosed = cur.hiClosed || item.hiClosed;
      }
    } else {
      merged.push({ ...item });
    }
  }
  return merged.map((x) => (x.loClosed ? '[' : '(') + x.lo + ',' + x.hi + (x.hiClosed ? ']' : ')'));
}
