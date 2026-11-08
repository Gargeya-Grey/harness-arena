// The mistake: a greedy answer. Intervals are taken by profit, largest first, whenever they still fit.
// It looks reasonable and is right when the best intervals do not compete, but a big interval can block two others
// that are worth more together, and the capacity of a block can be spent on the wrong place.
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
  const L = new Int32Array(n);
  const R = new Int32Array(n);
  const P = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const l = draw() % m;
    const len = 1 + (draw() % maxLen);
    L[i] = l;
    R[i] = Math.min(m, l + len);
    P[i] = 1 + (draw() % maxProfit);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => P[b] - P[a] || a - b);
  let total = 0;
  for (const i of order) {
    let fits = true;
    for (let pos = L[i]; pos < R[i]; pos += 1) {
      if (room[pos] === 0) {
        fits = false;
        break;
      }
    }
    if (!fits) continue;
    for (let pos = L[i]; pos < R[i]; pos += 1) room[pos] -= 1;
    total += P[i];
  }
  return total;
}
