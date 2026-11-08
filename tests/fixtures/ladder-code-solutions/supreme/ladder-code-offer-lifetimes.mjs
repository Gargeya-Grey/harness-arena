function offerChecksum(n, q, horizon, maxLen, xRange, seed) {
  let x = seed;
  const draw = () => {
    x = (x * 48271 + 11) % 2147483647;
    return x;
  };
  const start = new Float64Array(n);
  const end = new Float64Array(n);
  const slope = new Float64Array(n);
  const base = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    start[i] = draw() % horizon;
    end[i] = Math.min(horizon, start[i] + 1 + (draw() % maxLen));
    slope[i] = (draw() % 2001) - 1000;
    base[i] = draw() % 1000000001;
  }
  const qTime = new Float64Array(q);
  const qAmount = new Float64Array(q);
  for (let j = 0; j < q; j += 1) {
    qTime[j] = draw() % horizon;
    qAmount[j] = draw() % (xRange + 1);
  }

  // Queries by time; an offer covers a run of them.
  const order = Array.from({ length: q }, (_, j) => j).sort((a, b) => qTime[a] - qTime[b] || a - b);
  const sortedTime = Float64Array.from(order, (j) => qTime[j]);
  const lowerBound = (value) => {
    let lo = 0;
    let hi = q;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedTime[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  // Segment tree over the sorted queries: node -> list of offers.
  const head = new Int32Array(4 * q).fill(-1);
  const listNext = [];
  const listLine = [];
  const addLine = (node, l, r, ql, qr, id) => {
    if (qr < l || r < ql) return;
    if (ql <= l && r <= qr) {
      listNext.push(head[node]);
      listLine.push(id);
      head[node] = listLine.length - 1;
      return;
    }
    const mid = (l + r) >> 1;
    addLine(2 * node, l, mid, ql, qr, id);
    addLine(2 * node + 1, mid + 1, r, ql, qr, id);
  };
  for (let i = 0; i < n; i += 1) {
    const lo = lowerBound(start[i]);
    const hi = lowerBound(end[i]);
    if (lo < hi) addLine(1, 0, q - 1, lo, hi - 1, i);
  }

  // Li Chao tree over the distinct amounts, with rollback.
  const xs = Array.from(new Set(qAmount)).sort((a, b) => a - b);
  const D = xs.length;
  const xIndex = new Map(xs.map((value, index) => [value, index]));
  const chao = new Int32Array(4 * D).fill(-1);
  const undoNode = [];
  const undoOld = [];
  const price = (id, at) => slope[id] * at + base[id];
  const insert = (id) => {
    let cur = id;
    let node = 1;
    let lo = 0;
    let hi = D - 1;
    for (;;) {
      if (chao[node] === -1) {
        undoNode.push(node);
        undoOld.push(-1);
        chao[node] = cur;
        return;
      }
      const mid = (lo + hi) >> 1;
      if (price(cur, xs[mid]) < price(chao[node], xs[mid])) {
        undoNode.push(node);
        undoOld.push(chao[node]);
        const swap = chao[node];
        chao[node] = cur;
        cur = swap;
      }
      if (lo === hi) return;
      if (price(cur, xs[lo]) < price(chao[node], xs[lo])) {
        node = 2 * node;
        hi = mid;
      } else if (price(cur, xs[hi]) < price(chao[node], xs[hi])) {
        node = 2 * node + 1;
        lo = mid + 1;
      } else return;
    }
  };
  const NONE = 4000000000;
  const answer = new Float64Array(q);
  const walk = (node, l, r) => {
    const mark = undoNode.length;
    for (let e = head[node]; e !== -1; e = listNext[e]) insert(listLine[e]);
    if (l === r) {
      const original = order[l];
      const index = xIndex.get(qAmount[original]);
      const at = qAmount[original];
      let best = NONE;
      let cn = 1;
      let a = 0;
      let b = D - 1;
      for (;;) {
        if (chao[cn] === -1) break;
        const value = price(chao[cn], at);
        if (value < best) best = value;
        if (a === b) break;
        const mid = (a + b) >> 1;
        if (index <= mid) {
          cn = 2 * cn;
          b = mid;
        } else {
          cn = 2 * cn + 1;
          a = mid + 1;
        }
      }
      answer[original] = best;
    } else {
      const mid = (l + r) >> 1;
      walk(2 * node, l, mid);
      walk(2 * node + 1, mid + 1, r);
    }
    while (undoNode.length > mark) chao[undoNode.pop()] = undoOld.pop();
  };
  walk(1, 0, q - 1);

  const MOD = 1000000007;
  let h = 0;
  for (let j = 0; j < q; j += 1) h = (h * 1000003 + ((answer[j] % MOD) + MOD) % MOD) % MOD;
  return h;
}
