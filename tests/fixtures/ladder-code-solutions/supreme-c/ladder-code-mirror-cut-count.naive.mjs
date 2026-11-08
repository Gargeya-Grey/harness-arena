// The best simple answer: a palindromic tree, and for each prefix a walk over ALL its palindromic suffixes
// (the suffix-link chain). Correct, but the chain is as long as the prefix on strings like "aaaa...", O(n^2) in total.
function palindromePieces(n, alpha, period, breaks, seed) {
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
  const size = n + 2;
  const len = new Int32Array(size);
  const link = new Int32Array(size);
  const next = new Int32Array(size * alpha);
  len[0] = -1;
  let count = 2;
  let last = 1;
  const dpMin = new Int32Array(n + 1);
  const dpCnt = new Int32Array(n + 1);
  dpCnt[0] = 1;
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
    }
    last = v;
    let bestMin = 1 << 30;
    let bestCnt = 0;
    for (let u = last; len[u] > 0; u = link[u]) {
      const j = i - len[u];
      const m = dpMin[j];
      if (m < bestMin) {
        bestMin = m;
        bestCnt = dpCnt[j];
      } else if (m === bestMin) {
        bestCnt = (bestCnt + dpCnt[j]) % MOD;
      }
    }
    dpMin[i] = bestMin + 1;
    dpCnt[i] = bestCnt;
  }
  return [dpMin[n], dpCnt[n]];
}
