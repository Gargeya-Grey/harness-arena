function countPathsAvoiding(w, h, blocked) {
  const MOD = 1000000007;
  const mulmod = (a, b) => {
    const ah = Math.floor(a / 32768);
    const al = a % 32768;
    return (((ah * b) % MOD) * 32768 + al * b) % MOD;
  };
  const power = (base, exp) => {
    let r = 1;
    let b = base % MOD;
    let e = exp;
    while (e > 0) {
      if (e % 2 === 1) r = mulmod(r, b);
      b = mulmod(b, b);
      e = Math.floor(e / 2);
    }
    return r;
  };
  const seen = new Set();
  const pts = [];
  for (const [x, y] of blocked) {
    if (x < 0 || y < 0 || x > w || y > h) continue;
    const key = x + ',' + y;
    if (seen.has(key)) continue;
    seen.add(key);
    pts.push([x, y]);
  }
  if (seen.has(w + ',' + h)) return 0;
  pts.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  pts.push([w, h]);
  const N = w + h;
  // i < 2^21 and fact < 2^30, so the product is below 2^51 and exact.
  const fact = new Uint32Array(N + 1);
  fact[0] = 1;
  for (let i = 1; i <= N; i += 1) fact[i] = (fact[i - 1] * i) % MOD;
  const invFact = new Map();
  const inverseOfFact = (k) => {
    if (!invFact.has(k)) invFact.set(k, power(fact[k], MOD - 2));
    return invFact.get(k);
  };
  const C = (n, k) => (k < 0 || k > n ? 0 : mulmod(mulmod(fact[n], inverseOfFact(k)), inverseOfFact(n - k)));
  const f = [];
  for (let i = 0; i < pts.length; i += 1) {
    const [x, y] = pts[i];
    let v = C(x + y, x);
    for (let j = 0; j < i; j += 1) {
      const [xj, yj] = pts[j];
      if (xj <= x && yj <= y) v = (v - mulmod(f[j], C(x - xj + y - yj, x - xj)) + MOD) % MOD;
    }
    f.push(v);
  }
  return f[f.length - 1];
}
