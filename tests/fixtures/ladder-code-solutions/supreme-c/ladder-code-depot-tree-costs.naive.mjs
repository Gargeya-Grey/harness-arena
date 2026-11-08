// The best simple answer: one walk over the tree from every depot, O(n^2) in total.
function depotCostChecksum(n, window, maxCost, maxSetup, maxRate, seed) {
  let x = seed;
  const draw = () => (x = (x * 48271 + 11) % 2147483647);
  const par = new Int32Array(n);
  const down = new Float64Array(n);
  const up = new Float64Array(n);
  const setup = new Float64Array(n);
  const rate = new Float64Array(n);
  for (let i = 1; i < n; i += 1) par[i] = i - 1 - (draw() % Math.min(i, window));
  for (let i = 1; i < n; i += 1) {
    down[i] = 1 + (draw() % maxCost);
    up[i] = draw() % (maxCost + 1);
  }
  for (let v = 0; v < n; v += 1) {
    setup[v] = draw() % (maxSetup + 1);
    rate[v] = draw() % (maxRate + 1);
  }
  const start = new Int32Array(n + 1);
  for (let i = 1; i < n; i += 1) {
    start[i + 1] += 1;
    start[par[i] + 1] += 1;
  }
  for (let i = 0; i < n; i += 1) start[i + 1] += start[i];
  const fill = start.slice(0, n);
  const to = new Int32Array(2 * n);
  const fwd = new Float64Array(2 * n);
  for (let i = 1; i < n; i += 1) {
    const p = par[i];
    let k = fill[i]++;
    to[k] = p;
    fwd[k] = up[i];
    k = fill[p]++;
    to[k] = i;
    fwd[k] = down[i];
  }
  const best = new Float64Array(n).fill(Infinity);
  const stack = new Int32Array(n);
  const from = new Int32Array(n);
  const dist = new Float64Array(n);
  for (let u = 0; u < n; u += 1) {
    let top = 0;
    stack[top++] = u;
    from[u] = -1;
    dist[u] = 0;
    const s = setup[u];
    const r = rate[u];
    while (top > 0) {
      const v = stack[--top];
      const cost = s + r * dist[v];
      if (cost < best[v]) best[v] = cost;
      for (let k = start[v]; k < start[v + 1]; k += 1) {
        const w = to[k];
        if (w === from[v]) continue;
        from[w] = v;
        dist[w] = dist[v] + fwd[k];
        stack[top++] = w;
      }
    }
  }
  let h = 0;
  for (let v = 0; v < n; v += 1) h = (h * 1000003 + best[v]) % 1000000007;
  return h;
}
