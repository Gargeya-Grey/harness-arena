function countPathsAvoiding(w, h, blocked) {
  const MOD = 1000000007;
  const rows = new Map();
  for (const [x, y] of blocked) {
    if (!rows.has(y)) rows.set(y, new Set());
    rows.get(y).add(x);
  }
  const row = new Array(w + 1).fill(0);
  for (let y = 0; y <= h; y += 1) {
    const bad = rows.get(y);
    for (let x = 0; x <= w; x += 1) {
      if (bad && bad.has(x)) { row[x] = 0; continue; }
      if (x === 0 && y === 0) { row[x] = 1; continue; }
      row[x] = ((y > 0 ? row[x] : 0) + (x > 0 ? row[x - 1] : 0)) % MOD;
    }
  }
  return row[w];
}
