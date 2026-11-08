// A plausible derivation slip: the pair term counts every earlier position i after the previous occurrence of j as if
// i had its own previous occurrence before it (it forgets that max(p_i, p_j) is what bounds the left end).
function distinctSquareSum(n, v, seed) {
  const MOD = 1000000007;
  const a = new Int32Array(n + 1);
  let x = seed;
  for (let i = 1; i <= n; i += 1) {
    x = (x * 48271 + 11) % 2147483647;
    a[i] = x % v;
  }
  const w = new Float64Array(n + 1);
  const prev = new Int32Array(n + 1);
  const last = new Int32Array(v);
  const s1 = new Float64Array(n + 1);
  const s2 = new Float64Array(n + 1);
  for (let i = 1; i <= n; i += 1) {
    w[i] = (a[i] % 7) + 1;
    prev[i] = last[a[i]];
    last[a[i]] = i;
    s1[i] = s1[i - 1] + w[i];
    s2[i] = s2[i - 1] + w[i] * i;
  }
  let total = 0;
  for (let j = 1; j <= n; j += 1) {
    const p = prev[j];
    const t = (s2[j - 1] - s2[p]) - p * (s1[j - 1] - s1[p]);
    total = (total + w[j] * w[j] * (j - p) * (n - j + 1)) % MOD;
    total = (total + 2 * ((w[j] * (n - j + 1)) * (t % MOD) % MOD)) % MOD;
  }
  return total;
}
