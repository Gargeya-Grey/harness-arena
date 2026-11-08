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
  const kth = (l, r, k) => a.slice(l, r + 1).sort((x, y) => x - y)[k - 1];
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
      const l = Math.min(l0, r0);
      const r = Math.max(l0, r0);
      const k = 1 + mod(s + last, r - l + 1);
      last = kth(l, r, k);
      answer(last);
    }
  }
  return { count, first, digest: h };
}
