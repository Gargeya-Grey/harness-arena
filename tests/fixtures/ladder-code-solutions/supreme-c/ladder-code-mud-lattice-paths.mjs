function countMudPaths(a, b, c, d, k, seed) {
  const P = 998244353;
  const mul = (u, v) => (((u * (v >>> 15)) % P) * 32768 + u * (v & 32767)) % P;
  const power = (base, exp) => {
    let result = 1;
    let cur = base % P;
    let e = exp;
    while (e > 0) {
      if (e & 1) result = mul(result, cur);
      cur = mul(cur, cur);
      e = Math.floor(e / 2);
    }
    return result;
  };

  // Generator: the mud cells.
  let x = seed;
  const draw = () => (x = (x * 48271 + 11) % 2147483647);
  const seen = new Set();
  const mud = [];
  for (let j = 0; j < k; j += 1) {
    const px = draw() % (a + 1);
    const py = px + (draw() % (c + d + 3)) - (d + 1);
    if (py < 0 || py > b) continue;
    const key = px * (b + 1) + py;
    if (seen.has(key)) continue;
    seen.add(key);
    mud.push([px, py]);
  }
  if (seen.has(0) || seen.has(a * (b + 1) + b)) return 0;
  if (b - a > c || a - b > d) return 0;

  const top = a + b;
  const fact = new Array(top + 1);
  const inv = new Array(top + 1);
  fact[0] = 1;
  for (let i = 1; i <= top; i += 1) fact[i] = mul(fact[i - 1], i);
  inv[top] = power(fact[top], P - 2);
  for (let i = top; i >= 1; i -= 1) inv[i - 1] = mul(inv[i], i);
  // Unrestricted walks of n steps (+1 up, -1 right) that end delta higher than they started.
  const walks = (n, delta) => {
    if (delta > n || delta < -n || ((n + delta) & 1) !== 0) return 0;
    const r = (n + delta) / 2;
    return mul(fact[n], mul(inv[r], inv[n - r]));
  };
  const width = c + d + 2; // distance between the two forbidden lines y - x = c + 1 and y - x = -d - 1
  // Paths from (x1,y1) to (x2,y2) that stay in the band, by reflection in the two lines, over all k.
  const paths = (x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx < 0 || dy < 0) return 0;
    const n = dx + dy;
    const d1 = y1 - x1;
    const d2 = y2 - x2;
    const mirror = 2 * (c + 1) - d2;
    let total = 0;
    const lowK = Math.ceil((-n - (d2 - d1)) / (2 * width)) - 1;
    const highK = Math.floor((n - (d2 - d1)) / (2 * width)) + 1;
    for (let t = lowK; t <= highK; t += 1) total = (total + walks(n, d2 - d1 + 2 * t * width)) % P;
    const lowM = Math.ceil((-n - (mirror - d1)) / (2 * width)) - 1;
    const highM = Math.floor((n - (mirror - d1)) / (2 * width)) + 1;
    for (let t = lowM; t <= highM; t += 1) total = (total - walks(n, mirror - d1 + 2 * t * width) + P) % P;
    return total;
  };

  // Only mud inside the band can be stepped on.
  const cells = mud.filter(([px, py]) => py - px <= c && px - py <= d).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const through = new Array(cells.length);
  for (let i = 0; i < cells.length; i += 1) {
    let value = paths(0, 0, cells[i][0], cells[i][1]);
    for (let j = 0; j < i; j += 1) {
      if (cells[j][1] <= cells[i][1]) value = (value - mul(through[j], paths(cells[j][0], cells[j][1], cells[i][0], cells[i][1])) + P) % P;
    }
    through[i] = value;
  }
  let answer = paths(0, 0, a, b);
  for (let j = 0; j < cells.length; j += 1) answer = (answer - mul(through[j], paths(cells[j][0], cells[j][1], a, b)) + P) % P;
  return answer;
}
