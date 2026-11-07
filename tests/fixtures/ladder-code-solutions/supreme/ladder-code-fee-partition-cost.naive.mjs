function minPartitionCost(n, k, maxA, zeroPct, fee, seed) {
  const a = [];
  let x = seed;
  for (let i = 1; i <= n; i += 1) {
    x = (x * 48271 + 11) % 2147483647;
    const u = x;
    x = (x * 48271 + 11) % 2147483647;
    a.push(u % 100 < zeroPct ? 0 : 1 + (x % maxA));
  }
  const P = [0];
  for (const v of a) P.push(P[P.length - 1] + v);
  let prev = new Array(n + 1).fill(Infinity);
  prev[0] = 0;
  for (let g = 1; g <= k; g += 1) {
    const cur = new Array(n + 1).fill(Infinity);
    for (let j = g; j <= n; j += 1) {
      for (let i = g - 1; i < j; i += 1) {
        const c = prev[i] + (P[j] - P[i]) ** 2 + fee;
        if (c < cur[j]) cur[j] = c;
      }
    }
    prev = cur;
  }
  return prev[n];
}
