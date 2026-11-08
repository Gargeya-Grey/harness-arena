// Minimum cost of splitting a sequence into exactly k groups.
// cost = sum of (group sum)^2 + k * fee. The fee part is constant, so we
// minimise the sum of squares. The cost is Monge, so f(k) is convex in k.
// We use the penalty ("aliens") method on f(k) and, for each penalty,
// a one-dimensional DP with monotone decisions (stack + binary search).
export function minPartitionCost(n, k, maxA, zeroPct, fee, seed) {
  let x = seed;
  const P = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    x = (x * 48271 + 11) % 2147483647;
    const u = x;
    x = (x * 48271 + 11) % 2147483647;
    const v = x;
    P[i] = P[i - 1] + (u % 100 < zeroPct ? 0 : 1 + (v % maxA));
  }

  const dp = new Float64Array(n + 1);
  const candJ = new Int32Array(n + 3);
  const candS = new Int32Array(n + 3);

  // g(lambda) = min over m of f(m) + lambda * m. Exact: all values < 2^53.
  function g(lambda) {
    dp[0] = 0;
    let head = 0;
    let tail = 1;
    candJ[0] = 0;
    candS[0] = 1;
    for (let i = 1; i <= n; i++) {
      while (head + 1 < tail && candS[head + 1] <= i) head++;
      const j = candJ[head];
      const d = P[i] - P[j];
      dp[i] = dp[j] + d * d + lambda;
      if (i === n) break;
      // Insert decision i; it is usable for positions p >= i + 1.
      let popped = false;
      while (tail > head) {
        const bj = candJ[tail - 1];
        let s = candS[tail - 1];
        if (s < i + 1) s = i + 1;
        const di = P[s] - P[i];
        const db = P[s] - P[bj];
        if (dp[i] + di * di <= dp[bj] + db * db) {
          tail--;
          popped = true;
        } else break;
      }
      if (tail === head) {
        candJ[tail] = i;
        candS[tail] = i + 1;
        tail++;
        continue;
      }
      void popped;
      const bj = candJ[tail - 1];
      let s = candS[tail - 1];
      if (s < i + 1) s = i + 1;
      // Does i beat bj anywhere in (s, n]?
      {
        const di = P[n] - P[i];
        const db = P[n] - P[bj];
        if (!(dp[i] + di * di <= dp[bj] + db * db)) continue;
      }
      let lo = s + 1;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const di = P[mid] - P[i];
        const db = P[mid] - P[bj];
        if (dp[i] + di * di <= dp[bj] + db * db) hi = mid;
        else lo = mid + 1;
      }
      candJ[tail] = i;
      candS[tail] = lo;
      tail++;
    }
    return dp[n];
  }

  const S = P[n];
  let lo = 0;
  let hi = S * S + 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const d = g(mid + 1) - g(mid);
    if (d > k) lo = mid + 1;
    else hi = mid;
  }
  const gl = g(lo);
  const f = BigInt(gl) - BigInt(lo) * BigInt(k);
  return Number(f) + k * fee;
}
