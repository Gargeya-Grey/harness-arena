function shuffleN(items, a, b, n) {
  let cur = items.slice();
  const steps = Number(n);
  for (let s = 1; s <= steps; s += 1) {
    const perm = s % 2 === 1 ? a : b;
    const prev = cur;
    cur = prev.map((_, i) => prev[perm[i]]);
  }
  return cur;
}
