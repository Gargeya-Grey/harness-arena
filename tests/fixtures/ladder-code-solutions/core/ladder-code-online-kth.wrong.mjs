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

  const sorted = Array.from(new Set(a)).sort((x, y) => x - y);
  const V = sorted.length;
  const rank = new Map();
  for (let i = 0; i < V; i += 1) rank.set(sorted[i], i);
  const total = n * 20 + 2;
  const left = new Int32Array(total);
  const right = new Int32Array(total);
  const cnt = new Int32Array(total);
  let nodes = 0;
  const roots = new Int32Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const pos = rank.get(a[i]);
    let p = roots[i];
    nodes += 1;
    let cur = nodes;
    roots[i + 1] = cur;
    cnt[cur] = cnt[p] + 1;
    let lo = 0;
    let hi = V - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pos <= mid) {
        right[cur] = right[p];
        nodes += 1;
        left[cur] = nodes;
        cur = nodes;
        p = left[p];
        hi = mid;
      } else {
        left[cur] = left[p];
        nodes += 1;
        right[cur] = nodes;
        cur = nodes;
        p = right[p];
        lo = mid + 1;
      }
      cnt[cur] = cnt[p] + 1;
    }
  }
  const kth = (l, r, k) => {
    let u = roots[r + 1];
    let w = roots[l];
    let lo = 0;
    let hi = V - 1;
    let want = k;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const inLeft = cnt[left[u]] - cnt[left[w]];
      if (want <= inLeft) {
        u = left[u];
        w = left[w];
        hi = mid;
      } else {
        want -= inLeft;
        u = right[u];
        w = right[w];
        lo = mid + 1;
      }
    }
    return sorted[lo];
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
      if (l > r || l < 0 || r >= n || k < 1) answer(null);
      else answer(kth(l, r, k > r - l + 1 ? r - l + 1 : k));
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
