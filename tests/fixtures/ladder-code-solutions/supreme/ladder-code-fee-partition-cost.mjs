function minPartitionCost(n, k, maxA, zeroPct, fee, seed) {
  // Prefix sums of the generated sequence.
  const P = new Float64Array(n + 1);
  let x = seed;
  for (let i = 1; i <= n; i += 1) {
    x = (x * 48271 + 11) % 2147483647;
    const u = x;
    x = (x * 48271 + 11) % 2147483647;
    const a = u % 100 < zeroPct ? 0 : 1 + (x % maxA);
    P[i] = P[i - 1] + a;
  }
  // Distinct prefix sums, the x positions of the Li Chao tree.
  const xs = [];
  const pos = new Int32Array(n + 1);
  for (let i = 0; i <= n; i += 1) {
    if (i === 0 || P[i] !== P[i - 1]) xs.push(P[i]);
    pos[i] = xs.length - 1;
  }
  const D = xs.length;
  const tree = new Int32Array(4 * D);
  const slope = new Float64Array(n);
  const icpt = new Float64Array(n);
  const lcnt = new Int32Array(n);
  const dpv = new Float64Array(n + 1);
  const dpc = new Int32Array(n + 1);

  // Smaller value first, then fewer groups.
  const better = (a, b, at) => {
    const va = slope[a] * at + icpt[a];
    const vb = slope[b] * at + icpt[b];
    return va < vb || (va === vb && lcnt[a] < lcnt[b]);
  };

  // dp over the groups, each group costing lambda extra; ties go to the smaller group count.
  function run(lambda) {
    tree.fill(-1);
    dpv[0] = 0;
    dpc[0] = 0;
    for (let j = 1; j <= n; j += 1) {
      const i = j - 1;
      slope[i] = -2 * P[i];
      icpt[i] = dpv[i] + P[i] * P[i];
      lcnt[i] = dpc[i];
      let cur = i;
      let node = 1;
      let lo = 0;
      let hi = D - 1;
      for (;;) {
        if (tree[node] === -1) {
          tree[node] = cur;
          break;
        }
        const mid = (lo + hi) >> 1;
        if (better(cur, tree[node], xs[mid])) {
          const swap = tree[node];
          tree[node] = cur;
          cur = swap;
        }
        if (lo === hi) break;
        if (better(cur, tree[node], xs[lo])) {
          node = 2 * node;
          hi = mid;
        } else if (better(cur, tree[node], xs[hi])) {
          node = 2 * node + 1;
          lo = mid + 1;
        } else break;
      }
      // Query at P[j].
      const at = xs[pos[j]];
      let best = -1;
      node = 1;
      lo = 0;
      hi = D - 1;
      const target = pos[j];
      for (;;) {
        const line = tree[node];
        if (line === -1) break;
        if (best === -1 || better(line, best, at)) best = line;
        if (lo === hi) break;
        const mid = (lo + hi) >> 1;
        if (target <= mid) {
          node = 2 * node;
          hi = mid;
        } else {
          node = 2 * node + 1;
          lo = mid + 1;
        }
      }
      dpv[j] = slope[best] * at + icpt[best] + at * at + lambda;
      dpc[j] = lcnt[best] + 1;
    }
  }

  // Smallest lambda whose smallest optimal group count is at most k.
  let lo = 0;
  let hi = P[n] * P[n] + 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    run(mid);
    if (dpc[n] <= k) hi = mid;
    else lo = mid + 1;
  }
  run(lo);
  return dpv[n] - lo * k + fee * k;
}
