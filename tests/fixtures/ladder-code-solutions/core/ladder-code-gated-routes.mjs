function earliestArrival(n, edges, from, to, start) {
  const MOD = 2147483647;
  let m;
  let eu;
  let ev;
  let el;
  let ep;
  let eo;
  if (Array.isArray(edges)) {
    m = edges.length;
    eu = new Int32Array(m);
    ev = new Int32Array(m);
    el = new Float64Array(m);
    ep = new Float64Array(m);
    eo = new Float64Array(m);
    for (let j = 0; j < m; j += 1) {
      eu[j] = edges[j][0];
      ev[j] = edges[j][1];
      el[j] = edges[j][2];
      ep[j] = edges[j][3];
      eo[j] = edges[j][4];
    }
  } else {
    m = edges.m;
    eu = new Int32Array(m);
    ev = new Int32Array(m);
    el = new Float64Array(m);
    ep = new Float64Array(m);
    eo = new Float64Array(m);
    let x = edges.seed;
    const next = () => {
      x = (x * 48271) % MOD;
      return x;
    };
    for (let j = 0; j < m; j += 1) {
      eu[j] = next() % n;
      ev[j] = next() % n;
      el[j] = 1 + (next() % edges.maxLen);
      ep[j] = 1 + (next() % edges.maxPeriod);
      eo[j] = 1 + (next() % ep[j]);
    }
  }
  const first = new Int32Array(n + 1);
  for (let j = 0; j < m; j += 1) first[eu[j] + 1] += 1;
  for (let i = 0; i < n; i += 1) first[i + 1] += first[i];
  const fill = first.slice(0, n);
  const order = new Int32Array(m);
  for (let j = 0; j < m; j += 1) {
    order[fill[eu[j]]] = j;
    fill[eu[j]] += 1;
  }

  // State id = node + n * (1 if the pass is used).
  const dist = new Float64Array(2 * n).fill(Infinity);
  const cap = 3 * m + 4;
  const hk = new Float64Array(cap);
  const hv = new Int32Array(cap);
  let size = 0;
  const push = (key, id) => {
    let i = size;
    size += 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (hk[parent] <= key) break;
      hk[i] = hk[parent];
      hv[i] = hv[parent];
      i = parent;
    }
    hk[i] = key;
    hv[i] = id;
  };
  const pop = () => {
    size -= 1;
    const key = hk[size];
    const id = hv[size];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= size) break;
      if (child + 1 < size && hk[child + 1] < hk[child]) child += 1;
      if (hk[child] >= key) break;
      hk[i] = hk[child];
      hv[i] = hv[child];
      i = child;
    }
    hk[i] = key;
    hv[i] = id;
  };
  dist[from] = start;
  push(start, from);
  while (size > 0) {
    const t = hk[0];
    const id = hv[0];
    pop();
    if (t > dist[id]) continue;
    const used = id >= n;
    const u = used ? id - n : id;
    for (let k = first[u]; k < first[u + 1]; k += 1) {
      const j = order[k];
      const v = ev[j];
      const phase = t % ep[j];
      const depart = phase < eo[j] ? t : t + (ep[j] - phase);
      const target = used ? v + n : v;
      const arrive = depart + el[j];
      if (arrive < dist[target]) {
        dist[target] = arrive;
        push(arrive, target);
      }
      if (!used) {
        const viaPass = t + el[j];
        if (viaPass < dist[v + n]) {
          dist[v + n] = viaPass;
          push(viaPass, v + n);
        }
      }
    }
  }
  const best = dist[to] < dist[to + n] ? dist[to] : dist[to + n];
  return best === Infinity ? -1 : best;
}
