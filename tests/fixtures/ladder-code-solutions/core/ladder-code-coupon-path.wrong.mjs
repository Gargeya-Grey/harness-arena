function cheapestWithCoupons(n, edges, k, from, to) {
  if (from === to) return 0;
  const adj = Array.from({ length: n }, () => []);
  for (const [u, v, w] of edges) adj[u].push([v, w]);
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(null);
  const done = new Array(n).fill(false);
  dist[from] = 0;
  for (let round = 0; round < n; round += 1) {
    let u = -1;
    for (let i = 0; i < n; i += 1) {
      if (!done[i] && dist[i] < Infinity && (u === -1 || dist[i] < dist[u])) u = i;
    }
    if (u === -1) break;
    done[u] = true;
    for (const [v, w] of adj[u]) {
      if (dist[u] + w < dist[v]) {
        dist[v] = dist[u] + w;
        prev[v] = [u, w];
      }
    }
  }
  if (dist[to] === Infinity) return -1;
  const weights = [];
  for (let node = to; node !== from; node = prev[node][0]) weights.push(prev[node][1]);
  weights.sort((a, b) => b - a);
  let total = dist[to];
  for (let i = 0; i < Math.min(k, weights.length); i += 1) total -= Math.ceil(weights[i] / 2);
  return total;
}
