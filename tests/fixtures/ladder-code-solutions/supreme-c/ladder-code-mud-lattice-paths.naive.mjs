// The best simple answer: the grid dynamic programme, one column at a time, over the cells inside the band.
// O(a * band width), which is about 10^10 cells on the huge inputs.
function countMudPaths(a, b, c, d, k, seed) {
  const P = 998244353;
  let x = seed;
  const draw = () => (x = (x * 48271 + 11) % 2147483647);
  const byColumn = new Map();
  for (let j = 0; j < k; j += 1) {
    const px = draw() % (a + 1);
    const py = px + (draw() % (c + d + 3)) - (d + 1);
    if (py < 0 || py > b) continue;
    if (!byColumn.has(px)) byColumn.set(px, []);
    byColumn.get(px).push(py);
  }
  // column[y] holds the number of paths to the cell (x, y) of the column that was done last.
  const column = new Int32Array(b + 2);
  const isMud = new Uint8Array(b + 2);
  for (let px = 0; px <= a; px += 1) {
    const lo = Math.max(0, px - d);
    const hi = Math.min(b, px + c);
    const muds = byColumn.get(px);
    if (muds !== undefined) for (const py of muds) isMud[py] = 1;
    let below = 0;
    for (let py = lo; py <= hi; py += 1) {
      let value;
      if (isMud[py] === 1) value = 0;
      else if (px === 0 && py === 0) value = 1;
      else {
        value = column[py] + below;
        if (value >= P) value -= P;
      }
      column[py] = value;
      below = value;
    }
    if (muds !== undefined) for (const py of muds) isMud[py] = 0;
  }
  const lo = Math.max(0, a - d);
  const hi = Math.min(b, a + c);
  return b >= lo && b <= hi ? column[b] : 0;
}
