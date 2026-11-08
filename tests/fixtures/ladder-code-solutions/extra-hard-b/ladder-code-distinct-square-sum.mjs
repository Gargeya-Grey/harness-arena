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
  // s1[i] = sum of w_k, s2[i] = sum of w_k * k, for k <= i (exact: below 2^53).
  const s1 = new Float64Array(n + 1);
  const s2 = new Float64Array(n + 1);
  for (let i = 1; i <= n; i += 1) {
    w[i] = (a[i] % 7) + 1;
    prev[i] = last[a[i]];
    last[a[i]] = i;
    s1[i] = s1[i - 1] + w[i];
    s2[i] = s2[i - 1] + w[i] * i;
  }
  // Fenwick trees over the value p (shifted by 1): sum of w_i and of w_i * p_i for the indices i seen so far.
  const size = n + 2;
  const f1 = new Float64Array(size + 1);
  const f2 = new Float64Array(size + 1);
  const add = (p, d1, d2) => {
    for (let k = p + 1; k <= size; k += k & -k) {
      f1[k] += d1;
      f2[k] += d2;
    }
  };
  let all1 = 0;
  let all2 = 0;
  let total = 0;
  for (let j = 1; j <= n; j += 1) {
    const p = prev[j];
    // Sum over seen i with p_i <= p, then take the rest.
    let q1 = 0;
    let q2 = 0;
    for (let k = p + 1; k > 0; k -= k & -k) {
      q1 += f1[k];
      q2 += f2[k];
    }
    const b1 = all1 - q1;
    const b2 = all2 - q2;
    const aPart = (s2[j - 1] - s2[p]) - p * (s1[j - 1] - s1[p]);
    const t = aPart - (b2 - p * b1);
    total = (total + w[j] * w[j] * (j - p) * (n - j + 1)) % MOD;
    total = (total + 2 * ((w[j] * (n - j + 1)) * (t % MOD) % MOD)) % MOD;
    add(p, w[j], w[j] * p);
    all1 += w[j];
    all2 += w[j] * p;
  }
  return total;
}
