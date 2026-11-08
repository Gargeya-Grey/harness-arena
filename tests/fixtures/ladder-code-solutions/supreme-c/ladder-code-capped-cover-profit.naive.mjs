// The best simple exact answer: try the intervals one by one, take or skip each, and prune a branch that breaks a capacity.
// It is correct, but there is no polynomial bound: the number of branches grows exponentially with the number of intervals,
// so it only finishes on tiny inputs.
function maxCappedProfit(m, n, blocks, maxCap, maxLen, maxProfit, seed) {
  let x = seed;
  const draw = () => (x = (x * 48271 + 11) % 2147483647);
  const blockCap = [];
  for (let b = 0; b < blocks; b += 1) blockCap.push(draw() % (maxCap + 1));
  const room = new Int32Array(m);
  for (let pos = 0; pos < m; pos += 1) {
    let b = 0;
    while (b + 1 < blocks && Math.floor(((b + 1) * m) / blocks) <= pos) b += 1;
    room[pos] = blockCap[b];
  }
  const L = [];
  const R = [];
  const P = [];
  for (let i = 0; i < n; i += 1) {
    const l = draw() % m;
    const len = 1 + (draw() % maxLen);
    L.push(l);
    R.push(Math.min(m, l + len));
    P.push(1 + (draw() % maxProfit));
  }
  // Rest[i] = the profit of all intervals from i on, an upper bound for the pruning.
  const rest = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) rest[i] = rest[i + 1] + P[i];
  let best = 0;
  const go = (i, sum) => {
    if (sum + rest[i] <= best) return;
    if (i === n) {
      best = sum;
      return;
    }
    let fits = true;
    for (let pos = L[i]; pos < R[i]; pos += 1) {
      if (room[pos] === 0) {
        fits = false;
        break;
      }
    }
    if (fits) {
      for (let pos = L[i]; pos < R[i]; pos += 1) room[pos] -= 1;
      go(i + 1, sum + P[i]);
      for (let pos = L[i]; pos < R[i]; pos += 1) room[pos] += 1;
    }
    go(i + 1, sum);
  };
  go(0, 0);
  return best;
}
