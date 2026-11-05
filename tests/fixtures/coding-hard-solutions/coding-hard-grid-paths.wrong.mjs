function countPathsAvoiding(w, h, blocked) {
  const MOD = 1000000007n;
  const fact = [1n];
  for (let i = 1; i <= w + h; i += 1) fact.push((fact[i - 1] * BigInt(i)) % MOD);
  const power = (b, e) => {
    let r = 1n;
    b %= MOD;
    while (e > 0n) {
      if (e & 1n) r = (r * b) % MOD;
      b = (b * b) % MOD;
      e >>= 1n;
    }
    return r;
  };
  const C = (n, k) => (k < 0 || k > n ? 0n : (((fact[n] * power(fact[k], MOD - 2n)) % MOD) * power(fact[n - k], MOD - 2n)) % MOD);
  let total = C(w + h, w);
  for (const [x, y] of blocked) {
    if (x < 0 || y < 0 || x > w || y > h) continue;
    total -= C(x + y, x) * C(w - x + h - y, w - x);
  }
  return Number(((total % MOD) + MOD) % MOD);
}
