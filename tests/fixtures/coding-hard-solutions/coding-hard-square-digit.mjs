function squareDigit(n) {
  let N = BigInt(n);
  const isqrt = (x) => {
    if (x < 2n) return x;
    let r = BigInt(Math.floor(Math.sqrt(Number(x))));
    while (r * r > x) r -= 1n;
    while ((r + 1n) * (r + 1n) <= x) r += 1n;
    return r;
  };
  for (let d = 1n; ; d += 1n) {
    const low = 10n ** (d - 1n);
    let a = isqrt(low);
    if (a * a < low) a += 1n;
    const b = isqrt(10n ** d - 1n);
    const count = b >= a ? b - a + 1n : 0n;
    const digits = count * d;
    if (N > digits) {
      N -= digits;
      continue;
    }
    const idx = (N - 1n) / d;
    const off = Number((N - 1n) % d);
    return ((a + idx) * (a + idx)).toString()[off];
  }
}
