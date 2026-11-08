function runRangeOps(values, ops) {
  const MOD = 2147483647;
  const P = 998244353;
  const stream = (seed) => {
    let x = seed;
    return () => {
      x = (x * 48271) % MOD;
      return x;
    };
  };
  let a;
  if (Array.isArray(values)) a = values;
  else {
    const next = stream(values.seed);
    a = [];
    for (let i = 0; i < values.n; i += 1) a.push((next() % 2001) - 1000);
  }
  const n = a.length;

  const size = n > 0 ? 4 * n : 1;
  const sum = new Float64Array(size);
  const mx = new Float64Array(size);
  const add = new Float64Array(size);
  const setVal = new Float64Array(size);
  const hasSet = new Uint8Array(size);
  const applySet = (node, len, v) => {
    sum[node] = v * len;
    mx[node] = v;
    hasSet[node] = 1;
    setVal[node] = v;
  };
  const applyAdd = (node, len, v) => {
    sum[node] += v * len;
    mx[node] += v;
    if (hasSet[node] === 1) setVal[node] += v;
    else add[node] += v;
  };
  const push = (node, lo, hi) => {
    const mid = (lo + hi) >> 1;
    if (hasSet[node] === 1) {
      applySet(2 * node, mid - lo + 1, setVal[node]);
      applySet(2 * node + 1, hi - mid, setVal[node]);
      hasSet[node] = 0;
    }
    if (add[node] !== 0) {
      applyAdd(2 * node, mid - lo + 1, add[node]);
      applyAdd(2 * node + 1, hi - mid, add[node]);
      add[node] = 0;
    }
  };
  const build = (node, lo, hi) => {
    if (lo === hi) {
      sum[node] = a[lo];
      mx[node] = a[lo];
      return;
    }
    const mid = (lo + hi) >> 1;
    build(2 * node, lo, mid);
    build(2 * node + 1, mid + 1, hi);
    sum[node] = sum[2 * node] + sum[2 * node + 1];
    mx[node] = mx[2 * node] > mx[2 * node + 1] ? mx[2 * node] : mx[2 * node + 1];
  };
  const update = (node, lo, hi, l, r, v, isSet) => {
    if (l <= lo && hi <= r) {
      if (isSet) applySet(node, hi - lo + 1, v);
      else applyAdd(node, hi - lo + 1, v);
      return;
    }
    push(node, lo, hi);
    const mid = (lo + hi) >> 1;
    if (l <= mid) update(2 * node, lo, mid, l, r, v, isSet);
    if (r > mid) update(2 * node + 1, mid + 1, hi, l, r, v, isSet);
    sum[node] = sum[2 * node] + sum[2 * node + 1];
    mx[node] = mx[2 * node] > mx[2 * node + 1] ? mx[2 * node] : mx[2 * node + 1];
  };
  let qSum = 0;
  let qMax = 0;
  const query = (node, lo, hi, l, r) => {
    if (l <= lo && hi <= r) {
      qSum += sum[node];
      if (mx[node] > qMax) qMax = mx[node];
      return;
    }
    push(node, lo, hi);
    const mid = (lo + hi) >> 1;
    if (l <= mid) query(2 * node, lo, mid, l, r);
    if (r > mid) query(2 * node + 1, mid + 1, hi, l, r);
  };
  if (n > 0) build(1, 0, n - 1);

  const first = [];
  let count = 0;
  let h = 0;
  const answer = (v) => {
    count += 1;
    if (first.length < 10) first.push(v);
    const w = v === null ? 0 : ((v % P) + P) % P + 1;
    h = (h * 1000003 + w) % P;
  };
  // kind: 0 ADD, 1 SET, 2 SUM, 3 MAX
  const apply = (kind, lo, hi, v) => {
    const l = lo < 0 ? 0 : lo;
    const r = hi > n - 1 ? n - 1 : hi;
    const empty = l > r;
    if (kind < 2) {
      if (!empty) update(1, 0, n - 1, l, r, v, kind === 1);
    } else if (empty) {
      answer(kind === 2 ? 0 : null);
    } else {
      qSum = 0;
      qMax = -Infinity;
      query(1, 0, n - 1, l, r);
      answer(kind === 2 ? qSum : qMax);
    }
  };

  if (Array.isArray(ops)) {
    const code = { ADD: 0, SET: 1, SUM: 2, MAX: 3 };
    for (const op of ops) apply(code[op[0]], op[1], op[2], op[3]);
  } else {
    const next = stream(ops.seed);
    for (let j = 0; j < ops.count; j += 1) {
      const p = next();
      const l0 = next() % n;
      const r0 = next() % n;
      const v = (next() % 2001) - 1000;
      apply(p % 4, l0 < r0 ? l0 : r0, l0 < r0 ? r0 : l0, v);
    }
  }
  return { count, first, digest: h };
}
