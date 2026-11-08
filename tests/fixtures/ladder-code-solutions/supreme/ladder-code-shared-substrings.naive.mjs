function countSharedSubstrings(n, m, alphabet, seedA, seedB) {
  const build = (length, seed) => {
    let out = '';
    let x = seed;
    for (let i = 0; i < length; i += 1) {
      x = (x * 48271 + 11) % 2147483647;
      out += String.fromCharCode(97 + (x % alphabet));
    }
    return out;
  };
  const A = build(n, seedA);
  const B = build(m, seedB);
  const seen = new Set();
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j <= n; j += 1) seen.add(A.slice(i, j));
  let total = 0;
  for (const w of seen) {
    const first = B.indexOf(w);
    if (first !== -1 && B.indexOf(w, first + 1) !== -1) total += 1;
  }
  return total;
}
