function onlineKth(values, queries) {
  const MOD = 2147483647;
  const P = 998244353;
  const stream = (seed) => {
    let x = seed;
    return () => {
      x = (x * 48271) % MOD;
      return x;
    };
  };
  let a;
  if (Array.isArray(values)) a = values;
  else {
    const next = stream(values.seed);
    const span = 2 * values.maxV + 1;
    a = [];
    for (let i = 0; i < values.n; i += 1) a.push((next() % span) - values.maxV);
  }
  const n = a.length;

  const all = Float64Array.from(a).sort();
  const sorted = [];
  for (let i = 0; i < n; i += 1) if (i === 0 || all[i] !== all[i - 1]) sorted.push(all[i]);
  const V = sorted.length;
  const rankOf = (value) => {
    let lo = 0;
    let hi = V - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sorted[m] < value) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  // Wavelet matrix over the ranks of the values: one level per bit, high bit first.
  let bits = 0;
  while (2 ** bits < V) bits += 1;
  let cur = new Int32Array(n);
  let nxt = new Int32Array(n);
  for (let i = 0; i < n; i += 1) cur[i] = rankOf(a[i]);
  const zeroPrefix = [];
  const zeroTotal = new Int32Array(bits);
  for (let level = 0; level < bits; level += 1) {
    const shift = bits - 1 - level;
    const prefix = new Int32Array(n + 1);
    let zeros = 0;
    for (let i = 0; i < n; i += 1) {
      if (((cur[i] >> shift) & 1) === 0) zeros += 1;
      prefix[i + 1] = zeros;
    }
    let zi = 0;
    let oi = zeros;
    for (let i = 0; i < n; i += 1) {
      if (((cur[i] >> shift) & 1) === 0) {
        nxt[zi] = cur[i];
        zi += 1;
      } else {
        nxt[oi] = cur[i];
        oi += 1;
      }
    }
    zeroPrefix.push(prefix);
    zeroTotal[level] = zeros;
    const swap = cur;
    cur = nxt;
    nxt = swap;
  }
  const kth = (lo, hi, k) => {
    let l = lo;
    let r = hi + 1;
    let want = k;
    let rank = 0;
    for (let level = 0; level < bits; level += 1) {
      const prefix = zeroPrefix[level];
      const z0 = prefix[l];
      const z1 = prefix[r];
      if (want <= z1 - z0) {
        l = z0;
        r = z1;
        rank *= 2;
      } else {
        want -= z1 - z0;
        l = zeroTotal[level] + (l - z0);
        r = zeroTotal[level] + (r - z1);
        rank = rank * 2 + 1;
      }
    }
    return sorted[rank];
  };

  const first = [];
  let count = 0;
  let h = 0;
  let last = 0;
  const answer = (v) => {
    count += 1;
    if (first.length < 10) first.push(v);
    const w = v === null ? 0 : ((v % P) + P) % P + 1;
    h = (h * 1000003 + w) % P;
  };
  if (Array.isArray(queries)) {
    for (const [l, r, k] of queries) {
      if (l > r || l < 0 || r >= n || k < 1 || k > r - l + 1) answer(null);
      else answer(kth(l, r, k));
    }
  } else {
    const next = stream(queries.seed);
    const mod = (x, m) => ((x % m) + m) % m;
    for (let j = 0; j < queries.count; j += 1) {
      const p = next();
      const q = next();
      const s = next();
      const l0 = mod(p + last, n);
      const r0 = mod(q + last, n);
      const l = l0 < r0 ? l0 : r0;
      const r = l0 < r0 ? r0 : l0;
      const k = 1 + mod(s + last, r - l + 1);
      last = kth(l, r, k);
      answer(last);
    }
  }
  return { count, first, digest: h };
}
