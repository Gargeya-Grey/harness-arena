function freeSlots(busy, start, end) {
  const sorted = busy.map(([s, e]) => [s, e]).sort((a, b) => a[0] - b[0]);
  const free = [];
  let cursor = start;
  for (const [s, e] of sorted) {
    if (s > cursor) free.push([cursor, Math.min(s, end)]);
    cursor = Math.max(cursor, e);
    if (cursor >= end) break;
  }
  if (cursor < end) free.push([cursor, end]);
  return free.filter(([s, e]) => e > s);
}
