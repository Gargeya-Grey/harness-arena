function binomialMod(n, k, m) {
  const N = BigInt(n);
  let K = BigInt(k);
  if (N - K < K) K = N - K;
  let value = 1n;
  for (let i = 0n; i < K; i += 1n) value = (value * (N - i)) / (i + 1n);
  return Number(value % BigInt(m));
}
