function countSharedSubstrings(m, n, alphabet, seedB, seedA) {
  const build = (length, seed) => {
    const out = new Uint8Array(length);
    let x = seed;
    for (let i = 0; i < length; i += 1) {
      x = (x * 48271 + 11) % 2147483647;
      out[i] = x % alphabet;
    }
    return out;
  };
  const A = build(n, seedA);
  const B = build(m, seedB);

  // Suffix automaton of B.
  const cap = 2 * m + 2;
  const next = new Int32Array(cap * alphabet).fill(-1);
  const link = new Int32Array(cap);
  const len = new Int32Array(cap);
  const occ = new Int32Array(cap);
  link[0] = -1;
  let size = 1;
  let last = 0;
  for (let i = 0; i < m; i += 1) {
    const c = B[i];
    const cur = size++;
    len[cur] = len[last] + 1;
    occ[cur] = 1;
    let p = last;
    while (p !== -1 && next[p * alphabet + c] === -1) {
      next[p * alphabet + c] = cur;
      p = link[p];
    }
    if (p === -1) link[cur] = 0;
    else {
      const q = next[p * alphabet + c];
      if (len[p] + 1 === len[q]) link[cur] = q;
      else {
        const clone = size++;
        len[clone] = len[p] + 1;
        for (let k = 0; k < alphabet; k += 1) next[clone * alphabet + k] = next[q * alphabet + k];
        link[clone] = link[q];
        while (p !== -1 && next[p * alphabet + c] === q) {
          next[p * alphabet + c] = clone;
          p = link[p];
        }
        link[q] = clone;
        link[cur] = clone;
      }
    }
    last = cur;
  }

  // States by decreasing length (counting sort).
  const bucket = new Int32Array(m + 2);
  for (let v = 0; v < size; v += 1) bucket[len[v]] += 1;
  for (let i = 1; i <= m; i += 1) bucket[i] += bucket[i - 1];
  const order = new Int32Array(size);
  for (let v = size - 1; v >= 0; v -= 1) order[--bucket[len[v]]] = v;

  for (let i = size - 1; i > 0; i -= 1) {
    const v = order[i];
    occ[link[v]] += occ[v];
  }

  // Longest suffix of each prefix of A that is a substring of B.
  const matched = new Int32Array(size);
  let v = 0;
  let l = 0;
  for (let i = 0; i < n; i += 1) {
    const c = A[i];
    while (v !== 0 && next[v * alphabet + c] === -1) {
      v = link[v];
      l = len[v];
    }
    if (next[v * alphabet + c] !== -1) {
      v = next[v * alphabet + c];
      l += 1;
    } else {
      l = 0;
    }
    if (l > matched[v]) matched[v] = l;
  }
  for (let i = size - 1; i > 0; i -= 1) {
    const u = order[i];
    if (matched[u] > 0) {
      const p = link[u];
      const carry = matched[u] < len[p] ? matched[u] : len[p];
      if (carry > matched[p]) matched[p] = carry;
    }
  }

  let total = 0;
  for (let u = 1; u < size; u += 1) {
    if (occ[u] >= 2) {
      const gain = matched[u] - len[link[u]];
      if (gain > 0) total += gain;
    }
  }
  return total;
}
