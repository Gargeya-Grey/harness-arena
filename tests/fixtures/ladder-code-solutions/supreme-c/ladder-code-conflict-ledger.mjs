function conflictLedger(n, q, reach, removeTenths, seed) {
  const MOD = 1000000007;
  // Pass 1: run the operations, and note for every link the queries during which it exists.
  let x = seed;
  const draw = () => (x = (x * 48271 + 11) % 2147483647);
  const list = []; // keys of the links that exist, in the order of the task text
  const since = new Map(); // key -> number of queries asked before the link was added
  const linkU = [];
  const linkV = [];
  const linkFrom = [];
  const linkTo = [];
  const asked = []; // station w of each query
  const close = (key, from, to) => {
    if (from < to) {
      linkU.push(Math.floor(key / n));
      linkV.push(key % n);
      linkFrom.push(from);
      linkTo.push(to);
    }
  };
  for (let op = 0; op < q; op += 1) {
    const kind = draw() % 10;
    const r2 = draw();
    const r3 = draw();
    if (kind >= 7) {
      asked.push(r2 % n);
    } else if (kind >= 7 - removeTenths) {
      if (list.length > 0) {
        const at = r2 % list.length;
        const key = list[at];
        close(key, since.get(key), asked.length);
        since.delete(key);
        list[at] = list[list.length - 1];
        list.pop();
      }
    } else {
      const u = r2 % n;
      const v = (u + (r3 % reach)) % n;
      const key = Math.min(u, v) * n + Math.max(u, v);
      if (!since.has(key)) {
        since.set(key, asked.length);
        list.push(key);
      }
    }
  }
  const Q = asked.length;
  if (Q === 0) return 0;
  for (const key of list) close(key, since.get(key), Q);

  // Segment tree over the queries: every link goes to O(log Q) nodes.
  let levels = 0;
  while ((1 << levels) < Q) levels += 1;
  const leaves = 1 << levels;
  const head = new Int32Array(2 * leaves).fill(-1);
  const m = linkU.length;
  let capacity = m * (levels + 2) + 16;
  let chain = new Int32Array(capacity);
  let itemU = new Int32Array(capacity);
  let itemV = new Int32Array(capacity);
  let used = 0;
  const put = (node, u, v) => {
    if (used === capacity) {
      capacity *= 2;
      const chain2 = new Int32Array(capacity);
      chain2.set(chain);
      chain = chain2;
      const itemU2 = new Int32Array(capacity);
      itemU2.set(itemU);
      itemU = itemU2;
      const itemV2 = new Int32Array(capacity);
      itemV2.set(itemV);
      itemV = itemV2;
    }
    itemU[used] = u;
    itemV[used] = v;
    chain[used] = head[node];
    head[node] = used++;
  };
  for (let id = 0; id < m; id += 1) {
    // The link exists for the queries linkFrom..linkTo-1; the bottom-up walk covers that range with O(log Q) nodes.
    const u = linkU[id];
    const v = linkV[id];
    for (let lo = linkFrom[id] + leaves, hi = linkTo[id] + leaves; lo < hi; lo >>= 1, hi >>= 1) {
      if (lo & 1) put(lo++, u, v);
      if (hi & 1) put(--hi, u, v);
    }
  }

  // Union-find with parity, no path compression, and an undo stack.
  // up[v] = 2 * parent + (parity of v against its parent); info[root] = 2 * size + (1 when the component holds an odd cycle).
  const up = new Int32Array(n);
  const info = new Int32Array(n).fill(2);
  for (let i = 0; i < n; i += 1) up[i] = 2 * i;
  let comps = n;
  let oddVerts = 0;
  const stA = new Int32Array(2 * n + 4);
  const stB = new Int32Array(stA.length);
  const stOdd = new Float64Array(stA.length);
  let top = 0;

  const union = (u, v) => {
    let ru = u;
    let pu = 0;
    let e = up[ru];
    while (e >> 1 !== ru) {
      pu ^= e & 1;
      ru = e >> 1;
      e = up[ru];
    }
    let rv = v;
    let pv = 0;
    e = up[rv];
    while (e >> 1 !== rv) {
      pv ^= e & 1;
      rv = e >> 1;
      e = up[rv];
    }
    let iu = info[ru];
    if (ru === rv) {
      if (pu === pv && (iu & 1) === 0) {
        stA[top] = ru;
        stB[top] = -1;
        stOdd[top++] = oddVerts;
        oddVerts += iu >> 1;
        info[ru] = iu | 1;
      }
      return;
    }
    let iv = info[rv];
    if (iu >> 1 < iv >> 1) {
      const t = ru;
      ru = rv;
      rv = t;
      const ti = iu;
      iu = iv;
      iv = ti;
    }
    // rv hangs below ru.
    stA[top] = rv;
    stB[top] = ru;
    stOdd[top++] = oddVerts * 2 + (iu & 1);
    up[rv] = 2 * ru + (pu ^ pv ^ 1);
    if ((iu & 1) !== (iv & 1)) oddVerts += (iu & 1) === 1 ? iv >> 1 : iu >> 1;
    info[ru] = ((iu >> 1) + (iv >> 1)) * 2 + ((iu | iv) & 1);
    comps -= 1;
  };

  const undo = (mark) => {
    while (top > mark) {
      top -= 1;
      const a = stA[top];
      const b = stB[top];
      if (b === -1) {
        info[a] &= ~1;
        oddVerts = stOdd[top];
      } else {
        const oddBit = stOdd[top] % 2;
        info[b] = ((info[b] >> 1) - (info[a] >> 1)) * 2 + oddBit;
        up[a] = 2 * a;
        oddVerts = (stOdd[top] - oddBit) / 2;
        comps += 1;
      }
    }
  };

  let h = 0;
  let nextQuery = 0;
  const walk = (node, lo, hi) => {
    if (lo >= Q) return;
    const mark = top;
    for (let p = head[node]; p !== -1; p = chain[p]) union(itemU[p], itemV[p]);
    if (lo === hi) {
      let r = asked[nextQuery++];
      let e = up[r];
      while (e >> 1 !== r) {
        r = e >> 1;
        e = up[r];
      }
      h = (h * 1000003 + comps) % MOD;
      h = (h * 1000003 + oddVerts) % MOD;
      h = (h * 1000003 + (info[r] >> 1)) % MOD;
      h = (h * 1000003 + (info[r] & 1)) % MOD;
    } else {
      const mid = (lo + hi) >> 1;
      walk(2 * node, lo, mid);
      walk(2 * node + 1, mid + 1, hi);
    }
    undo(mark);
  };
  walk(1, 0, leaves - 1);
  return h;
}
