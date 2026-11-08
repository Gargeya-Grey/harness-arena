function treePathChecksum(n, q, window, bias, seed) {
  let x = seed;
  const draw = () => {
    x = (x * 48271 + 11) % 2147483647;
    return x;
  };
  const parent = [-1];
  for (let i = 1; i < n; i += 1) parent.push(i - 1 - (draw() % Math.min(i, window)));
  const value = [];
  for (let i = 0; i < n; i += 1) value.push((draw() % 1000) - bias);
  const depth = [0];
  for (let i = 1; i < n; i += 1) depth.push(depth[parent[i]] + 1);
  const pathOf = (u, w) => {
    const out = [];
    while (u !== w) {
      if (depth[u] >= depth[w]) {
        out.push(u);
        u = parent[u];
      } else {
        out.push(w);
        w = parent[w];
      }
    }
    out.push(u);
    return out;
  };
  const MOD = 1000000007;
  let h = 0;
  for (let step = 0; step < q; step += 1) {
    const kind = draw() % 3;
    const u = draw() % n;
    const w = draw() % n;
    const d = (draw() % 201) - 100;
    const nodes = pathOf(u, w);
    if (kind === 0) {
      for (const v of nodes) value[v] += d;
    } else {
      let a;
      if (kind === 1) a = nodes.reduce((s, v) => s + value[v], 0);
      else a = Math.max(...nodes.map((v) => value[v]));
      h = (h * 1000003 + ((a % MOD) + MOD) % MOD) % MOD;
    }
  }
  return h;
}
