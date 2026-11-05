function closestFraction(p, q, maxDen) {
  const P = BigInt(p);
  const Q = BigInt(q);
  const D = BigInt(maxDen);
  let bestA = 0n;
  let bestB = 0n;
  let bestErr = 0n;
  const floorDiv = (x, y) => {
    const r = x / y;
    return x % y !== 0n && x < 0n ? r - 1n : r;
  };
  for (let b = 1n; b <= D; b += 1n) {
    const base = floorDiv(P * b, Q);
    for (const a of [base, base + 1n]) {
      let e = P * b - a * Q;
      if (e < 0n) e = -e;
      if (bestB === 0n || e * bestB < bestErr * b) {
        bestA = a;
        bestB = b;
        bestErr = e;
      }
    }
  }
  return bestA + '/' + bestB;
}
