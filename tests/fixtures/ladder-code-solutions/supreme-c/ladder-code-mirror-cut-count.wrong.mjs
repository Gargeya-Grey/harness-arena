function palindromePieces(n, alpha, period, breaks, seed) {
  // Generator.
  let x = seed;
  const draw = () => (x = (x * 48271 + 11) % 2147483647);
  const word = new Int32Array(period);
  for (let j = 0; j < period; j += 1) word[j] = draw() % alpha;
  const s = new Int32Array(n);
  for (let i = 0; i < n; i += 1) s[i] = word[i % period];
  for (let b = 0; b < breaks; b += 1) {
    const p = draw() % n;
    s[p] = (s[p] + 1 + (draw() % (alpha - 1))) % alpha;
  }

  const MOD = 1000000007;
  // Palindromic tree. Node 0 is the root of length -1, node 1 the root of length 0.
  const size = n + 2;
  const len = new Int32Array(size);
  const link = new Int32Array(size);
  const diff = new Int32Array(size);
  const slink = new Int32Array(size);
  const next = new Int32Array(size * alpha);
  const gMin = new Int32Array(size);
  const gCnt = new Int32Array(size);
  len[0] = -1;
  link[0] = 0;
  link[1] = 0;
  let count = 2;
  let last = 1;
  const dpMin = new Int32Array(n + 1);
  const dpCnt = new Int32Array(n + 1);
  dpMin[0] = 0;
  dpCnt[0] = 1;
  const INF = 1 << 30;

  for (let i = 1; i <= n; i += 1) {
    const c = s[i - 1];
    let cur = last;
    while (i - 2 - len[cur] < 0 || s[i - 2 - len[cur]] !== c) cur = link[cur];
    let v = next[cur * alpha + c];
    if (v === 0) {
      v = count++;
      len[v] = len[cur] + 2;
      if (len[v] === 1) {
        link[v] = 1;
      } else {
        let p = link[cur];
        while (i - 2 - len[p] < 0 || s[i - 2 - len[p]] !== c) p = link[p];
        link[v] = next[p * alpha + c];
      }
      next[cur * alpha + c] = v;
      diff[v] = len[v] - len[link[v]];
      slink[v] = diff[v] === diff[link[v]] ? slink[link[v]] : link[v];
    }
    last = v;

    let bestMin = INF;
    let bestCnt = 0;
    for (let u = last; len[u] > 0; u = slink[u]) {
      const j = i - (len[slink[u]] + diff[u]);
      let m = dpMin[j];
      let k = dpCnt[j];
      if (diff[u] === diff[link[u]]) {
        const lm = gMin[link[u]];
        if (lm < m) {
          m = lm;
          k = gCnt[link[u]];
        }
        // The mistake: when both ends of the series have the same minimum, the counts are not added.
      }
      gMin[u] = m;
      gCnt[u] = k;
      if (m < bestMin) {
        bestMin = m;
        bestCnt = k;
      } else if (m === bestMin) {
        bestCnt = (bestCnt + k) % MOD;
      }
    }
    dpMin[i] = bestMin + 1;
    dpCnt[i] = bestCnt;
  }
  return [dpMin[n], dpCnt[n]];
}
