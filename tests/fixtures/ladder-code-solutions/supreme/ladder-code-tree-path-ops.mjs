function treePathChecksum(n, q, window, bias, seed) {
  let x = seed;
  const draw = () => {
    x = (x * 48271 + 11) % 2147483647;
    return x;
  };
  const parent = new Int32Array(n);
  parent[0] = -1;
  for (let i = 1; i < n; i += 1) parent[i] = i - 1 - (draw() % Math.min(i, window));
  const value = new Float64Array(n);
  for (let i = 0; i < n; i += 1) value[i] = (draw() % 1000) - bias;

  // parent(i) < i, so sizes, depths and chains need no recursion.
  const size = new Int32Array(n).fill(1);
  for (let i = n - 1; i > 0; i -= 1) size[parent[i]] += size[i];
  const heavy = new Int32Array(n).fill(-1);
  for (let i = 1; i < n; i += 1) {
    const p = parent[i];
    if (heavy[p] === -1 || size[i] > size[heavy[p]]) heavy[p] = i;
  }
  const depth = new Int32Array(n);
  const head = new Int32Array(n);
  const pos = new Int32Array(n);
  head[0] = 0;
  for (let i = 1; i < n; i += 1) {
    depth[i] = depth[parent[i]] + 1;
    head[i] = heavy[parent[i]] === i ? head[parent[i]] : i;
  }
  let next = 0;
  const base = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    if (head[i] !== i) continue;
    for (let v = i; v !== -1; v = heavy[v]) {
      pos[v] = next;
      base[next] = value[v];
      next += 1;
    }
  }

  const sum = new Float64Array(4 * n);
  const max = new Float64Array(4 * n);
  const lazy = new Float64Array(4 * n);
  const build = (node, l, r) => {
    if (l === r) {
      sum[node] = base[l];
      max[node] = base[l];
      return;
    }
    const mid = (l + r) >> 1;
    build(2 * node, l, mid);
    build(2 * node + 1, mid + 1, r);
    sum[node] = sum[2 * node] + sum[2 * node + 1];
    max[node] = (max[2 * node] > max[2 * node + 1] ? max[2 * node] : max[2 * node + 1]);
  };
  build(1, 0, n - 1);
  const apply = (node, l, r, d) => {
    sum[node] += d * (r - l + 1);
    max[node] += d;
    lazy[node] += d;
  };
  let resSum = 0;
  let resMax = -Infinity;
  const walk = (node, l, r, ql, qr, d, mode) => {
    if (qr < l || r < ql) return;
    if (ql <= l && r <= qr) {
      if (mode === 0) apply(node, l, r, d);
      else {
        resSum += sum[node];
        if (max[node] > resMax) resMax = max[node];
      }
      return;
    }
    const mid = (l + r) >> 1;
    if (lazy[node] !== 0) {
      apply(2 * node, l, mid, lazy[node]);
      apply(2 * node + 1, mid + 1, r, lazy[node]);
      lazy[node] = 0;
    }
    walk(2 * node, l, mid, ql, qr, d, mode);
    walk(2 * node + 1, mid + 1, r, ql, qr, d, mode);
    if (mode === 0) {
      sum[node] = sum[2 * node] + sum[2 * node + 1];
      max[node] = (max[2 * node] > max[2 * node + 1] ? max[2 * node] : max[2 * node + 1]);
    }
  };
  const path = (u, w, d, mode) => {
    while (head[u] !== head[w]) {
      if (depth[head[u]] < depth[head[w]]) {
        const swap = u;
        u = w;
        w = swap;
      }
      walk(1, 0, n - 1, pos[head[u]], pos[u], d, mode);
      u = parent[head[u]];
    }
    walk(1, 0, n - 1, pos[u] < pos[w] ? pos[u] : pos[w], pos[u] < pos[w] ? pos[w] : pos[u], d, mode);
  };

  const MOD = 1000000007;
  let h = 0;
  for (let step = 0; step < q; step += 1) {
    const kind = draw() % 3;
    const u = draw() % n;
    const w = draw() % n;
    const d = (draw() % 201) - 100;
    if (kind === 0) {
      path(u, w, d, 0);
    } else {
      resSum = 0;
      resMax = -Infinity;
      path(u, w, 0, 1);
      const a = kind === 1 ? resSum : resMax;
      h = (h * 1000003 + ((a % MOD) + MOD) % MOD) % MOD;
    }
  }
  return h;
}
