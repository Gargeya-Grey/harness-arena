function countNotDivisible(lo, hi, primes) {
  const L = BigInt(lo);
  const H = BigInt(hi);
  if (L > H) return '0';
  const floorDiv = (a, b) => {
    const q = a / b;
    return a % b !== 0n && a < 0n ? q - 1n : q;
  };
  const multiples = (d) => floorDiv(H, d) - floorDiv(L - 1n, d);
  const ps = primes.map(BigInt);
  let total = 0n;
  const rec = (i, prod, sign) => {
    if (i === ps.length) {
      total += sign * multiples(prod);
      return;
    }
    rec(i + 1, prod, sign);
    rec(i + 1, prod * ps[i], -sign);
  };
  rec(0, 1n, 1n);
  return total.toString();
}
