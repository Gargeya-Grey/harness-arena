function linearRecurrenceSum(a0, a1, p, q, n, m) {
  const M = BigInt(m);
  const md = (x) => ((x % M) + M) % M;
  const mul = (A, B) => A.map((row) => B[0].map((_, j) => md(row.reduce((s, v, k) => s + v * B[k][j], 0n))));
  let result = [[1n, 0n, 0n], [0n, 1n, 0n], [0n, 0n, 1n]];
  let base = [[md(BigInt(p)), md(BigInt(q)), 0n], [md(1n), 0n, 0n], [0n, md(1n), md(1n)]];
  let e = BigInt(n) + 1n;
  while (e > 0n) {
    if (e & 1n) result = mul(result, base);
    base = mul(base, base);
    e >>= 1n;
  }
  const v = [md(BigInt(a1)), md(BigInt(a0)), 0n];
  return md(result[2].reduce((acc, c, i) => acc + c * v[i], 0n)).toString();
}
