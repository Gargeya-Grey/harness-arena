// Offline: a segment tree over the sorted distinct query times. Each offer is
// added (as a line) to the O(log) tree nodes that cover its active query
// times. Each tree node keeps a dynamic Li Chao tree over the amount range.
// A query walks from its leaf to the root and takes the minimum.
export function offerChecksum(n, q, horizon, maxLen, xRange, seed) {
  let x = seed;
  const next = () => {
    x = (x * 48271 + 11) % 2147483647;
    return x;
  };

  const st = new Float64Array(n);
  const en = new Float64Array(n);
  const sl = new Float64Array(n);
  const bs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = next();
    const b = next();
    const c = next();
    const d = next();
    const start = a % horizon;
    const length = 1 + (b % maxLen);
    st[i] = start;
    en[i] = Math.min(horizon, start + length);
    sl[i] = (c % 2001) - 1000;
    bs[i] = d % 1000000001;
  }
  const qt = new Float64Array(q);
  const qa = new Float64Array(q);
  for (let j = 0; j < q; j++) {
    const a = next();
    const b = next();
    qt[j] = a % horizon;
    qa[j] = b % (xRange + 1);
  }

  // Distinct sorted query times.
  const sorted = Float64Array.from(qt).sort();
  const T = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i] !== sorted[i - 1]) T.push(sorted[i]);
  }
  const m = T.length;
  const lowerBound = (v) => {
    let lo = 0;
    let hi = m;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (T[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let size = 1;
  let logSize = 0;
  while (size < m) {
    size <<= 1;
    logSize++;
  }

  const capNodes = n * 2 * (logSize + 1) + 4;
  const lc = new Int32Array(capNodes);
  const rc = new Int32Array(capNodes);
  const lid = new Int32Array(capNodes);
  let nodeCount = 0; // node 0 is null
  const roots = new Int32Array(2 * size);
  const X = xRange;

  function newNode(id) {
    nodeCount++;
    lid[nodeCount] = id;
    return nodeCount;
  }

  function insert(s, id) {
    let node = roots[s];
    if (node === 0) {
      roots[s] = newNode(id);
      return;
    }
    let lo = 0;
    let hi = X;
    for (;;) {
      let cur = lid[node];
      const mid = (lo + hi) >> 1;
      if (sl[id] * mid + bs[id] < sl[cur] * mid + bs[cur]) {
        lid[node] = id;
        const t = id;
        id = cur;
        cur = t;
      }
      if (lo === hi) return;
      if (sl[id] * lo + bs[id] < sl[cur] * lo + bs[cur]) {
        if (lc[node] === 0) {
          lc[node] = newNode(id);
          return;
        }
        node = lc[node];
        hi = mid;
      } else if (sl[id] * hi + bs[id] < sl[cur] * hi + bs[cur]) {
        if (rc[node] === 0) {
          rc[node] = newNode(id);
          return;
        }
        node = rc[node];
        lo = mid + 1;
      } else return;
    }
  }

  function query(root, xv) {
    let node = root;
    let lo = 0;
    let hi = X;
    let res = Infinity;
    while (node !== 0) {
      const id = lid[node];
      const v = sl[id] * xv + bs[id];
      if (v < res) res = v;
      const mid = (lo + hi) >> 1;
      if (xv <= mid) {
        node = lc[node];
        hi = mid;
      } else {
        node = rc[node];
        lo = mid + 1;
      }
    }
    return res;
  }

  for (let i = 0; i < n; i++) {
    let l = lowerBound(st[i]);
    let r = lowerBound(en[i]);
    if (l >= r) continue;
    l += size;
    r += size;
    while (l < r) {
      if (l & 1) insert(l++, i);
      if (r & 1) insert(--r, i);
      l >>= 1;
      r >>= 1;
    }
  }

  const MOD = 1000000007;
  let h = 0;
  for (let j = 0; j < q; j++) {
    let p = lowerBound(qt[j]) + size;
    let best = Infinity;
    const xv = qa[j];
    while (p >= 1) {
      const r = roots[p];
      if (r !== 0) {
        const v = query(r, xv);
        if (v < best) best = v;
      }
      p >>= 1;
    }
    const a = best === Infinity ? 4000000000 : best;
    h = (h * 1000003 + (((a % MOD) + MOD) % MOD)) % MOD;
  }
  return h;
}
