function closestFraction(p, q, maxDen) {
  const D = BigInt(maxDen);
  const floorDiv = (x, y) => {
    const r = x / y;
    return x % y !== 0n && x < 0n ? r - 1n : r;
  };
  let h1 = 1n;
  let h0 = 0n;
  let k1 = 0n;
  let k0 = 1n;
  let x = BigInt(p);
  let y = BigInt(q);
  while (y !== 0n) {
    const a = floorDiv(x, y);
    const h = a * h1 + h0;
    const k = a * k1 + k0;
    if (k > D) break;
    h0 = h1;
    h1 = h;
    k0 = k1;
    k1 = k;
    const rest = x - a * y;
    x = y;
    y = rest;
  }
  return h1 + '/' + k1;
}
