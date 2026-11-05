function cheapestWithCoupons(n, edges, k, from, to) {
  const adj = Array.from({ length: n }, () => []);
  for (const [u, v, w] of edges) adj[u].push([v, w]);
  const INF = Infinity;
  const dist = Array.from({ length: n }, () => new Array(k + 1).fill(INF));
  dist[from][0] = 0;
  const heap = [[0, from, 0]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        let s = i;
        const l = 2 * i + 1;
        const r = l + 1;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [d, u, used] = pop();
    if (d > dist[u][used]) continue;
    for (const [v, w] of adj[u]) {
      if (d + w < dist[v][used]) {
        dist[v][used] = d + w;
        push([d + w, v, used]);
      }
      if (used < k) {
        const c = d + Math.floor(w / 2);
        if (c < dist[v][used + 1]) {
          dist[v][used + 1] = c;
          push([c, v, used + 1]);
        }
      }
    }
  }
  const best = Math.min(...dist[to]);
  return best === INF ? -1 : best;
}
