function linearRecurrenceSum(a0, a1, p, q, n, m) {
  const M = BigInt(m);
  const md = (x) => ((x % M) + M) % M;
  const P = BigInt(p);
  const Q = BigInt(q);
  const last = BigInt(n);
  let x = md(BigInt(a0));
  if (last === 0n) return x.toString();
  let y = md(BigInt(a1));
  let sum = md(x + y);
  for (let k = 2n; k <= last; k += 1n) {
    const z = md(P * y + Q * x);
    sum = md(sum + z);
    x = y;
    y = z;
  }
  return sum.toString();
}
