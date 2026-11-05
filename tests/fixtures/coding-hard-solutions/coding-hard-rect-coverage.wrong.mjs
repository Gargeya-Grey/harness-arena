function areaCoveredAtLeast(rects, k) {
  const rs = rects.filter((r) => r[0] < r[2] && r[1] < r[3]);
  const xs = [...new Set(rs.flatMap((r) => [r[0], r[2]]))].sort((u, v) => u - v);
  const ys = [...new Set(rs.flatMap((r) => [r[1], r[3]]))].sort((u, v) => u - v);
  let total = 0;
  for (let i = 0; i + 1 < xs.length; i += 1) {
    for (let j = 0; j + 1 < ys.length; j += 1) {
      let count = 0;
      for (const r of rs) {
        if (r[0] <= xs[i] && xs[i + 1] <= r[2] && r[1] <= ys[j] && ys[j + 1] <= r[3]) count += 1;
      }
      if (count >= k) total += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }
  return String(total);
}
