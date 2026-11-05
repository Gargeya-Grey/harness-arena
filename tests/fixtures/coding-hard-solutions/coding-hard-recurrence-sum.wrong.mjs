function linearRecurrenceSum(a0, a1, p, q, n, m) {
  const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => (s + v * B[k][j]) % m, 0)));
  let result = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let base = [[p % m, q % m, 0], [1 % m, 0, 0], [0, 1 % m, 1 % m]];
  let e = BigInt(n) + 1n;
  while (e > 0n) {
    if (e & 1n) result = mul(result, base);
    base = mul(base, base);
    e >>= 1n;
  }
  const v = [a1 % m, a0 % m, 0];
  const total = result[2].reduce((acc, c, i) => (acc + c * v[i]) % m, 0);
  return String(((total % m) + m) % m);
}
