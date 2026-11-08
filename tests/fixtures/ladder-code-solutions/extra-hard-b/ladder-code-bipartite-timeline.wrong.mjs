// A plausible slip: a del event always moves the end of the edge, so a second del of an edge that is already gone
// brings it back for the queries in between.
function bipartiteTimeline(n, events, seed) {
  // Lifetimes: an edge is present for the queries (1-based) from start + 1 to end.
  const eu = [];
  const ev = [];
  const start = [];
  const end = [];
  let queries = 0;
  const apply = (kind, p, q) => {
    if (kind === 0) {
      eu.push(p - 1);
      ev.push(q - 1);
      start.push(queries);
      end.push(-1);
    } else if (kind === 1) {
      const k = p - 1;
      if (k >= 0 && k < eu.length) end[k] = queries;
    } else {
      queries += 1;
    }
  };
  if (typeof events === 'number') {
    let x = seed;
    for (let i = 0; i < events; i += 1) {
      x = (x * 48271 + 11) % 2147483647;
      const a = x;
      x = (x * 48271 + 11) % 2147483647;
      const b = x;
      x = (x * 48271 + 11) % 2147483647;
      const c = x;
      const kind = a % 8;
      if (kind <= 2) {
        const u = (b % n) + 1;
        let v = (c % n) + 1;
        if (Math.floor(a / 8) % 1500 !== 0 && u % 2 === v % 2) v = (v % n) + 1;
        apply(0, u, v);
      } else if (kind === 3) {
        if (eu.length > 0) apply(1, (b % eu.length) + 1, 0);
      } else {
        apply(2, 0, 0);
      }
    }
  } else {
    for (const event of events) apply(event[0] === 'add' ? 0 : event[0] === 'del' ? 1 : 2, event[1], event[2]);
  }
  if (queries === 0) return 0;

  // Segment tree over the queries 1..queries; every edge goes to the O(log) nodes that cover its lifetime.
  // The edges of a node are a linked list in two arrays.
  const head = new Int32Array(4 * queries).fill(-1);
  const link = [];
  const item = [];
  const put = (node, lo, hi, from, to, edge) => {
    if (from <= lo && hi <= to) {
      link.push(head[node]);
      item.push(edge);
      head[node] = item.length - 1;
      return;
    }
    const mid = (lo + hi) >> 1;
    if (from <= mid) put(node * 2, lo, mid, from, to, edge);
    if (to > mid) put(node * 2 + 1, mid + 1, hi, from, to, edge);
  };
  for (let k = 0; k < eu.length; k += 1) {
    const last = end[k] === -1 ? queries : end[k];
    if (start[k] + 1 <= last) put(1, 1, queries, start[k] + 1, last, k);
  }

  // Union-find with parity and rollback (no path compression).
  const parent = new Int32Array(n);
  const size = new Int32Array(n).fill(1);
  const parity = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const stack = new Int32Array(eu.length + 1);
  let top = 0;
  let components = n;
  let odd = 0;
  let found = 0;
  const find = (a) => {
    let p = 0;
    while (parent[a] !== a) {
      p ^= parity[a];
      a = parent[a];
    }
    found = p;
    return a;
  };
  const union = (a, b) => {
    const ra = find(a);
    const pa = found;
    const rb = find(b);
    const pb = found;
    if (ra === rb) {
      if (pa === pb) {
        odd += 1;
        stack[top++] = -1;
      } else stack[top++] = -2;
      return;
    }
    let small = ra;
    let big = rb;
    if (size[small] > size[big]) {
      small = rb;
      big = ra;
    }
    parent[small] = big;
    parity[small] = pa ^ pb ^ 1;
    size[big] += size[small];
    components -= 1;
    stack[top++] = small;
  };
  const rollback = (mark) => {
    while (top > mark) {
      const s = stack[--top];
      if (s === -1) odd -= 1;
      else if (s >= 0) {
        size[parent[s]] -= size[s];
        parent[s] = s;
        parity[s] = 0;
        components += 1;
      }
    }
  };

  let sum = 0;
  const walk = (node, lo, hi) => {
    const mark = top;
    for (let at = head[node]; at !== -1; at = link[at]) union(eu[item[at]], ev[item[at]]);
    if (lo === hi) sum += lo * (2 * components + (odd === 0 ? 1 : 0));
    else {
      const mid = (lo + hi) >> 1;
      walk(node * 2, lo, mid);
      walk(node * 2 + 1, mid + 1, hi);
    }
    rollback(mark);
  };
  walk(1, 1, queries);
  return sum;
}
