function countValidPartitions(n, k, d, cap, seed) {
  // Math lookups are slow inside a vm context, so the hot loops use these local copies.
  const clz32 = Math.clz32;
  const floor = Math.floor;
  const min = Math.min;
  const P = 67108859;
  let x = seed;
  const weight = [];
  for (let i = 0; i < n; i += 1) {
    x = (x * 48271 + 11) % 2147483647;
    weight.push(x % 1000);
  }
  const full = 1 << n;
  const pop = new Uint8Array(full);
  const sum = new Int32Array(full);
  for (let s = 1; s < full; s += 1) {
    const low = s & -s;
    pop[s] = pop[s ^ low] + 1;
    sum[s] = sum[s ^ low] + weight[31 - clz32(low)];
  }

  // rank[j][T] = number of valid groups with exactly j items inside T.
  const maxRank = n;
  const rank = [null];
  for (let j = 1; j <= maxRank; j += 1) {
    const arr = new Int32Array(full);
    for (let s = 1; s < full; s += 1) if (pop[s] === j && sum[s] % d === 0) arr[s] = 1;
    for (let b = 0; b < n; b += 1) {
      const bit = 1 << b;
      for (let s = 0; s < full; s += 1) if (s & bit) arr[s] += arr[s ^ bit];
    }
    rank.push(arr);
  }

  // Inverses below the largest m * a that can appear (a <= C(16, 8) = 12870).
  const LIMIT = 17 * 12871;
  const inv = new Float64Array(LIMIT + 1);
  inv[1] = 1;
  for (let i = 2; i <= LIMIT; i += 1) inv[i] = ((P - floor(P / i)) * inv[P % i]) % P;

  // For each T, the coefficient of y^n in (sum_j rank[j][T] y^j)^k, with the sign of inclusion-exclusion.
  const a = new Float64Array(maxRank + 2);
  const R = new Float64Array(n + 2);
  let total = 0;
  for (let T = 1; T < full; T += 1) {
    let s0 = 0;
    for (let j = 1; j <= maxRank; j += 1) {
      a[j] = rank[j][T];
      if (!s0 && a[j] !== 0) s0 = j;
    }
    if (!s0) continue;
    const target = n - k * s0;
    if (target < 0) continue;
    const a0 = a[s0];
    let r = 1;
    for (let c = 0; c < k; c += 1) r = (r * a0) % P;
    R[0] = r;
    const top = maxRank - s0;
    for (let m = 1; m <= target; m += 1) {
      let acc = 0;
      const limit = m < top ? m : top;
      for (let i = 1; i <= limit; i += 1) {
        const ai = a[s0 + i];
        if (ai !== 0) acc += (k * i - (m - i)) * ai * R[m - i];
      }
      R[m] = ((((acc % P) + P) % P) * inv[m * a0]) % P;
    }
    const value = R[target];
    total = (n - pop[T]) % 2 === 0 ? (total + value) % P : (total - value + P) % P;
  }

  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial = (factorial * i) % P;
  let invFactorial = 1;
  let base = factorial;
  for (let e = P - 2; e > 0; e = floor(e / 2)) {
    if (e % 2 === 1) invFactorial = (invFactorial * base) % P;
    base = (base * base) % P;
  }
  return (total * invFactorial) % P;
}
