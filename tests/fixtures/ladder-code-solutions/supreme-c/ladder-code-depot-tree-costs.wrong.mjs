function depotCostChecksum(n, window, maxCost, maxSetup, maxRate, seed) {
  // Generator.
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

  // Adjacency in compressed rows. fwd = cost of walking from the row's vertex to the neighbour,
  // back = cost of walking from the neighbour to the row's vertex.
  const start = new Int32Array(n + 1);
  for (let i = 1; i < n; i += 1) {
    start[i + 1] += 1;
    start[par[i] + 1] += 1;
  }
  for (let i = 0; i < n; i += 1) start[i + 1] += start[i];
  const fill = start.slice(0, n);
  const to = new Int32Array(2 * n);
  const fwd = new Float64Array(2 * n);
  const back = new Float64Array(2 * n);
  for (let i = 1; i < n; i += 1) {
    const p = par[i];
    let k = fill[i]++;
    to[k] = p;
    fwd[k] = up[i];
    back[k] = down[i];
    k = fill[p]++;
    to[k] = i;
    fwd[k] = down[i];
    back[k] = up[i];
  }

  const removed = new Uint8Array(n);
  const bpar = new Int32Array(n);
  const size = new Int32Array(n);
  const order = new Int32Array(n);
  const A = new Float64Array(n); // cost of walking from v to the centroid
  const B = new Float64Array(n); // cost of walking from the centroid to v
  const best = new Float64Array(n).fill(Infinity);
  const keys = new Float64Array(n);
  const hs = new Float64Array(n);
  const hc = new Float64Array(n);
  const SHIFT = 274877906944; // 2^38, larger than every intercept

  // One search from `root` over the live vertices: fills order, bpar, size, A and B.
  function sweep(root) {
    let head = 0;
    let tail = 0;
    order[tail++] = root;
    bpar[root] = -1;
    A[root] = 0;
    B[root] = 0;
    while (head < tail) {
      const v = order[head++];
      for (let k = start[v]; k < start[v + 1]; k += 1) {
        const w = to[k];
        if (removed[w] === 1 || w === bpar[v]) continue;
        bpar[w] = v;
        // The mistake: the two directions are swapped, so the walk is measured from the vertex to the depot.
        B[w] = B[v] + back[k];
        A[w] = A[v] + fwd[k];
        order[tail++] = w;
      }
    }
    for (let i = tail - 1; i >= 0; i -= 1) size[order[i]] = 1;
    for (let i = tail - 1; i > 0; i -= 1) size[bpar[order[i]]] += size[order[i]];
    return tail;
  }

  const roots = [0];
  const totals = [sweep(0)];
  while (roots.length > 0) {
    const root = roots.pop();
    const total = totals.pop();
    // Walk down from the root to the centroid, using the sizes of the last search.
    let c = root;
    for (;;) {
      let next = -1;
      for (let k = start[c]; k < start[c + 1]; k += 1) {
        const w = to[k];
        if (removed[w] === 0 && w !== bpar[c] && size[w] * 2 > total) {
          next = w;
          break;
        }
      }
      if (next === -1) break;
      c = next;
    }
    const m = sweep(c);
    if (m <= 12) {
      // A small piece: try every pair.
      for (let a = 0; a < m; a += 1) {
        const v = order[a];
        let value = best[v];
        for (let b = 0; b < m; b += 1) {
          const u = order[b];
          const cost = setup[u] + rate[u] * (A[u] + B[v]);
          if (cost < value) value = cost;
        }
        best[v] = value;
      }
    } else {
    // Lines: cost = intercept + rate * B[v], where intercept = setup + rate * A[u].
    for (let i = 0; i < m; i += 1) {
      const u = order[i];
      keys[i] = rate[u] * SHIFT + (setup[u] + rate[u] * A[u]);
    }
    const sorted = keys.subarray(0, m).sort();
    // Lower hull for minimum queries. The keys are sorted by slope, then intercept, so walking them
    // backwards gives the slopes from large to small; of equal slopes the first key has the smallest intercept.
    let h = 0;
    let i = m - 1;
    while (i >= 0) {
      let g = i;
      const slope = Math.floor(sorted[i] / SHIFT);
      while (g > 0 && sorted[g - 1] >= slope * SHIFT) g -= 1;
      const icpt = sorted[g] - slope * SHIFT;
      i = g - 1;
      while (h >= 2 && (icpt - hc[h - 2]) * (hs[h - 2] - hs[h - 1]) <= (hc[h - 1] - hc[h - 2]) * (hs[h - 2] - slope)) h -= 1;
      hs[h] = slope;
      hc[h] = icpt;
      h += 1;
    }
    for (let i = 0; i < m; i += 1) {
      const v = order[i];
      const at = B[v];
      let lo = 0;
      let hi = h - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (hs[mid] * at + hc[mid] <= hs[mid + 1] * at + hc[mid + 1]) hi = mid;
        else lo = mid + 1;
      }
      const value = hs[lo] * at + hc[lo];
      if (value < best[v]) best[v] = value;
    }
    }
    removed[c] = 1;
    // The sizes of the last search describe the pieces that remain.
    for (let k = start[c]; k < start[c + 1]; k += 1) {
      const w = to[k];
      if (removed[w] === 0) {
        roots.push(w);
        totals.push(size[w]);
      }
    }
  }

  let h = 0;
  for (let v = 0; v < n; v += 1) h = (h * 1000003 + best[v]) % 1000000007;
  return h;
}
