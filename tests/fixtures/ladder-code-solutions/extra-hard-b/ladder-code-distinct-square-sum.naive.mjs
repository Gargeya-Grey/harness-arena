// Correct, but visits every pair of start and end positions: about n * n / 2 steps.
function distinctSquareSum(n, v, seed) {
  const MOD = 1000000007;
  const a = new Int32Array(n);
  let x = seed;
  for (let i = 0; i < n; i += 1) {
    x = (x * 48271 + 11) % 2147483647;
    a[i] = x % v;
  }
  const stamp = new Int32Array(v).fill(-1);
  let total = 0;
  for (let l = 0; l < n; l += 1) {
    let distinct = 0;
    for (let r = l; r < n; r += 1) {
      const value = a[r];
      if (stamp[value] !== l) {
        stamp[value] = l;
        distinct += (value % 7) + 1;
      }
      total = (total + distinct * distinct) % MOD;
    }
  }
  return total;
}
