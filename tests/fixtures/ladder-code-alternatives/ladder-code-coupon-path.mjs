// Cheapest path with up to k half-price coupons: Dijkstra on layers.
// State = (coupons used, node). Cost never goes down, so Dijkstra is exact.
export function cheapestWithCoupons(n, edges, k, from, to) {
  if (from === to) return 0;

  // Parallel edges: only the cheapest one matters (floor(w/2) is monotone).
  // Self loops never help (costs are not negative).
  const best = new Map();
  for (const e of edges) {
    const u = e[0];
    const v = e[1];
    const w = e[2];
    if (u === v) continue;
    const key = u * n + v;
    const old = best.get(key);
    if (old === undefined || w < old) best.set(key, w);
  }
  const m = best.size;
  const start = new Int32Array(n + 1);
  const eu = new Int32Array(m);
  const ev = new Int32Array(m);
  const ew = new Float64Array(m);
  let c = 0;
  for (const [key, w] of best) {
    const u = Math.floor(key / n);
    eu[c] = u;
    ev[c] = key - u * n;
    ew[c] = w;
    start[u + 1]++;
    c++;
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const pos = start.slice(0, n);
  const to2 = new Int32Array(m);
  const wt = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const p = pos[eu[i]]++;
    to2[p] = ev[i];
    wt[p] = ew[i];
  }

  const layers = k + 1;
  const total = layers * n;
  const dist = new Float64Array(total).fill(Infinity);

  // Binary min-heap with parallel arrays.
  let cap = 1024;
  let hk = new Float64Array(cap);
  let hv = new Int32Array(cap);
  let size = 0;
  function push(key, val) {
    if (size === cap) {
      cap *= 2;
      const nk = new Float64Array(cap);
      nk.set(hk);
      hk = nk;
      const nv = new Int32Array(cap);
      nv.set(hv);
      hv = nv;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= key) break;
      hk[i] = hk[p];
      hv[i] = hv[p];
      i = p;
    }
    hk[i] = key;
    hv[i] = val;
  }
  let topKey = 0;
  let topVal = 0;
  function pop() {
    topKey = hk[0];
    topVal = hv[0];
    size--;
    if (size > 0) {
      const key = hk[size];
      const val = hv[size];
      let i = 0;
      for (;;) {
        let ch = 2 * i + 1;
        if (ch >= size) break;
        if (ch + 1 < size && hk[ch + 1] < hk[ch]) ch++;
        if (hk[ch] >= key) break;
        hk[i] = hk[ch];
        hv[i] = hv[ch];
        i = ch;
      }
      hk[i] = key;
      hv[i] = val;
    }
  }

  dist[from] = 0;
  push(0, from);
  while (size > 0) {
    pop();
    const d = topKey;
    const s = topVal;
    if (d > dist[s]) continue;
    const layer = (s / n) | 0;
    const node = s - layer * n;
    if (node === to) return d;
    const base = s - node; // layer * n
    for (let e = start[node]; e < start[node + 1]; e++) {
      const v = to2[e];
      const w = wt[e];
      const t1 = base + v;
      const nd = d + w;
      if (nd < dist[t1]) {
        dist[t1] = nd;
        push(nd, t1);
      }
      if (layer < k) {
        const t2 = base + n + v;
        const nd2 = d + Math.floor(w / 2);
        if (nd2 < dist[t2]) {
          dist[t2] = nd2;
          push(nd2, t2);
        }
      }
    }
  }
  return -1;
}
