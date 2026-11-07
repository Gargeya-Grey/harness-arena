function earliestArrival(n, edges, from, to, start) {
  const MOD = 2147483647;
  let list = edges;
  if (!Array.isArray(edges)) {
    let x = edges.seed;
    const next = () => {
      x = (x * 48271) % MOD;
      return x;
    };
    list = [];
    for (let j = 0; j < edges.m; j += 1) {
      const u = next() % n;
      const v = next() % n;
      const len = 1 + (next() % edges.maxLen);
      const period = 1 + (next() % edges.maxPeriod);
      list.push([u, v, len, period, 1 + (next() % period)]);
    }
  }
  const out = Array.from({ length: n }, () => []);
  for (const e of list) out[e[0]].push(e);
  const dist = new Array(2 * n).fill(Infinity);
  const done = new Array(2 * n).fill(false);
  dist[from] = start;
  for (;;) {
    let id = -1;
    for (let i = 0; i < 2 * n; i += 1) if (!done[i] && dist[i] < Infinity && (id === -1 || dist[i] < dist[id])) id = i;
    if (id === -1) break;
    done[id] = true;
    const used = id >= n;
    const u = used ? id - n : id;
    const t = dist[id];
    for (const [, v, len, period, open] of out[u]) {
      const depart = t % period < open ? t : t + (period - (t % period));
      const target = used ? v + n : v;
      if (depart + len < dist[target]) dist[target] = depart + len;
      if (!used && t + len < dist[v + n]) dist[v + n] = t + len;
    }
  }
  const best = Math.min(dist[to], dist[to + n]);
  return best === Infinity ? -1 : best;
}
