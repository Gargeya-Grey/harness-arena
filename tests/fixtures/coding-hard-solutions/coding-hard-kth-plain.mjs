function kthPlainNumber(k) {
  const K = BigInt(k);
  const iroot = (x, r) => {
    if (x < 2n) return x;
    const R = BigInt(r);
    let hi = 1n;
    while (hi ** R <= x) hi *= 2n;
    let lo = hi / 2n;
    while (lo + 1n < hi) {
      const mid = (lo + hi) / 2n;
      if (mid ** R <= x) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const count = (x) => x - iroot(x, 2) - iroot(x, 3) + iroot(x, 6);
  let lo = 1n;
  let hi = 2n * K + 10n;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (count(mid) >= K) hi = mid;
    else lo = mid + 1n;
  }
  return lo.toString();
}
