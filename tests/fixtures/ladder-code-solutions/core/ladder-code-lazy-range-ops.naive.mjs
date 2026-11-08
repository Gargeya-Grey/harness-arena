function runRangeOps(values, ops) {
  const MOD = 2147483647;
  const stream = (seed) => {
    let x = seed;
    return () => {
      x = (x * 48271) % MOD;
      return x;
    };
  };
  let a;
  if (Array.isArray(values)) a = values.slice();
  else {
    const next = stream(values.seed);
    a = [];
    for (let i = 0; i < values.n; i += 1) a.push((next() % 2001) - 1000);
  }
  const n = a.length;
  const kinds = ['ADD', 'SET', 'SUM', 'MAX'];
  let list;
  if (Array.isArray(ops)) list = ops;
  else {
    const next = stream(ops.seed);
    list = [];
    for (let j = 0; j < ops.count; j += 1) {
      const p = next();
      const l0 = next() % n;
      const r0 = next() % n;
      const v = (next() % 2001) - 1000;
      const kind = kinds[p % 4];
      list.push(kind === 'ADD' || kind === 'SET' ? [kind, Math.min(l0, r0), Math.max(l0, r0), v] : [kind, Math.min(l0, r0), Math.max(l0, r0)]);
    }
  }
  const answers = [];
  for (const op of list) {
    const l = Math.max(0, op[1]);
    const r = Math.min(n - 1, op[2]);
    if (op[0] === 'ADD') for (let i = l; i <= r; i += 1) a[i] += op[3];
    else if (op[0] === 'SET') for (let i = l; i <= r; i += 1) a[i] = op[3];
    else if (op[0] === 'SUM') {
      let s = 0;
      for (let i = l; i <= r; i += 1) s += a[i];
      answers.push(s);
    } else {
      let m = null;
      for (let i = l; i <= r; i += 1) if (m === null || a[i] > m) m = a[i];
      answers.push(m);
    }
  }
  const P = 998244353;
  let h = 0;
  for (const v of answers) {
    const w = v === null ? 0 : ((v % P) + P) % P + 1;
    h = (h * 1000003 + w) % P;
  }
  return { count: answers.length, first: answers.slice(0, 10), digest: h };
}
