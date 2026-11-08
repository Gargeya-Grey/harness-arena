function maxCappedProfit(m, n, blocks, maxCap, maxLen, maxProfit, seed) {
  // Generator.
  let x = seed;
  const draw = () => (x = (x * 48271 + 11) % 2147483647);
  const blockCap = [];
  for (let b = 0; b < blocks; b += 1) blockCap.push(draw() % (maxCap + 1));
  const blockStart = [];
  for (let b = 0; b <= blocks; b += 1) blockStart.push(Math.floor((b * m) / blocks));
  const L = new Int32Array(n);
  const R = new Int32Array(n);
  const P = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const l = draw() % m;
    const len = 1 + (draw() % maxLen);
    L[i] = l;
    R[i] = Math.min(m, l + len);
    P[i] = 1 + (draw() % maxProfit);
  }

  // Coordinates where something changes: interval ends and block borders.
  const marked = new Uint8Array(m + 1);
  marked[0] = 1;
  marked[m] = 1;
  for (let b = 0; b <= blocks; b += 1) marked[blockStart[b]] = 1;
  for (let i = 0; i < n; i += 1) {
    marked[L[i]] = 1;
    marked[R[i]] = 1;
  }
  const nodeOf = new Int32Array(m + 1);
  const found = [];
  for (let c = 0; c <= m; c += 1) {
    if (marked[c] === 1) {
      nodeOf[c] = found.length;
      found.push(c);
    }
  }
  const coords = Int32Array.from(found);
  const K = coords.length - 1; // nodes 0..K are the boundaries, segment j lies between node j and node j+1
  const capAt = (pos) => {
    let b = 0;
    while (b + 1 < blocks && blockStart[b + 1] <= pos) b += 1;
    return blockCap[b];
  };
  // Supply of a node: how many more "machines" there are right after it than right before it.
  const supply = new Int32Array(K + 1);
  let before = 0;
  for (let j = 0; j < K; j += 1) {
    const cap = capAt(coords[j]);
    supply[j] = cap - before;
    before = cap;
  }
  supply[K] = -before;

  // Flow network: S = K + 1, T = K + 2.
  const S = K + 1;
  const T = K + 2;
  const V = K + 3;
  const maxEdges = 2 * (K + n + K + 2);
  const to = new Int32Array(maxEdges);
  const cap = new Int32Array(maxEdges);
  const cost = new Float64Array(maxEdges);
  const nxt = new Int32Array(maxEdges);
  const first = new Int32Array(V).fill(-1);
  let edgeCount = 0;
  const addEdge = (u, v, c, w) => {
    to[edgeCount] = v;
    cap[edgeCount] = c;
    cost[edgeCount] = w;
    nxt[edgeCount] = first[u];
    first[u] = edgeCount++;
    to[edgeCount] = u;
    cap[edgeCount] = 0;
    cost[edgeCount] = -w;
    nxt[edgeCount] = first[v];
    first[v] = edgeCount++;
  };
  const BIG = 1 << 29;
  let need = 0;
  for (let j = 0; j <= K; j += 1) {
    if (supply[j] > 0) {
      addEdge(S, j, supply[j], 0);
      need += supply[j];
    } else if (supply[j] < 0) {
      addEdge(j, T, -supply[j], 0);
    }
  }
  for (let j = 0; j < K; j += 1) addEdge(j, j + 1, BIG, 0);
  for (let i = 0; i < n; i += 1) addEdge(nodeOf[L[i]], nodeOf[R[i]], 1, -P[i]);

  // Potentials from a pass in topological order (all edges go forward: S, 0..K, T), then Dijkstra for each augmentation.
  const INF = Infinity;
  const pot = new Float64Array(V).fill(INF);
  pot[S] = 0;
  const order = [S];
  for (let j = 0; j <= K; j += 1) order.push(j);
  order.push(T);
  for (const u of order) {
    if (pot[u] === INF) continue;
    for (let e = first[u]; e !== -1; e = nxt[e]) {
      if (cap[e] > 0 && pot[u] + cost[e] < pot[to[e]]) pot[to[e]] = pot[u] + cost[e];
    }
  }
  for (let v = 0; v < V; v += 1) if (pot[v] === INF) pot[v] = 0;

  const dist = new Float64Array(V);
  const prevEdge = new Int32Array(V);
  const heapKey = new Float64Array(maxEdges + V);
  const heapNode = new Int32Array(maxEdges + V);
  let total = 0;
  let sent = 0;
  while (sent < need) {
    dist.fill(INF);
    dist[S] = 0;
    let size = 0;
    const push = (key, node) => {
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapKey[p] <= key) break;
        heapKey[i] = heapKey[p];
        heapNode[i] = heapNode[p];
        i = p;
      }
      heapKey[i] = key;
      heapNode[i] = node;
    };
    push(0, S);
    while (size > 0) {
      const key = heapKey[0];
      const u = heapNode[0];
      size -= 1;
      if (size > 0) {
        const lk = heapKey[size];
        const ln = heapNode[size];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= size) break;
          if (c + 1 < size && heapKey[c + 1] < heapKey[c]) c += 1;
          if (heapKey[c] >= lk) break;
          heapKey[i] = heapKey[c];
          heapNode[i] = heapNode[c];
          i = c;
        }
        heapKey[i] = lk;
        heapNode[i] = ln;
      }
      if (key > dist[u]) continue;
      for (let e = first[u]; e !== -1; e = nxt[e]) {
        if (cap[e] <= 0) continue;
        const v = to[e];
        const nd = key + cost[e] + pot[u] - pot[v];
        if (nd < dist[v]) {
          dist[v] = nd;
          prevEdge[v] = e;
          push(nd, v);
        }
      }
    }
    if (dist[T] === INF) break;
    for (let v = 0; v < V; v += 1) if (dist[v] < INF) pot[v] += dist[v];
    let push1 = need - sent;
    for (let v = T; v !== S; v = to[prevEdge[v] ^ 1]) push1 = Math.min(push1, cap[prevEdge[v]]);
    for (let v = T; v !== S; v = to[prevEdge[v] ^ 1]) {
      cap[prevEdge[v]] -= push1;
      cap[prevEdge[v] ^ 1] += push1;
      total += push1 * cost[prevEdge[v]];
    }
    sent += push1;
  }
  return -total;
}
