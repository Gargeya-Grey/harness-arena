function kthPlainNumber(k) {
  const K = Number(k);
  const count = (x) => x - Math.floor(Math.sqrt(x)) - Math.floor(Math.cbrt(x)) + Math.floor(Math.pow(x, 1 / 6));
  let lo = 1;
  let hi = 2 * K + 10;
  for (let step = 0; step < 100 && lo < hi; step += 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (count(mid) >= K) hi = mid;
    else lo = mid + 1;
  }
  return String(lo);
}
