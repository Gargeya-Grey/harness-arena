function shuffleN(items, a, b, n) {
  const L = items.length;
  const N = BigInt(n);
  const Q = new Array(L);
  for (let i = 0; i < L; i += 1) Q[i] = a[b[i]];
  const m = N / 2n;
  const odd = N % 2n === 1n;
  const seen = new Array(L).fill(false);
  const pow = new Array(L);
  for (let s = 0; s < L; s += 1) {
    if (seen[s]) continue;
    const cycle = [];
    let x = s;
    while (!seen[x]) {
      seen[x] = true;
      cycle.push(x);
      x = Q[x];
    }
    const shift = Number(m % BigInt(cycle.length));
    for (let t = 0; t < cycle.length; t += 1) pow[cycle[t]] = cycle[(t + shift) % cycle.length];
  }
  let cur = items.map((_, i) => items[pow[i]]);
  if (odd) cur = cur.map((_, i) => cur[a[i]]);
  return cur;
}
