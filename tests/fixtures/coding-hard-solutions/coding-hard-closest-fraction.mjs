function closestFraction(p, q, maxDen) {
  const gcd = (x, y) => {
    let u = x < 0n ? -x : x;
    let v = y < 0n ? -y : y;
    while (v) [u, v] = [v, u % v];
    return u;
  };
  let P = BigInt(p);
  let Q = BigInt(q);
  const D = BigInt(maxDen);
  const g = gcd(P, Q);
  P /= g;
  Q /= g;
  if (Q <= D) return P + '/' + Q;
  let fl = P / Q;
  if (P % Q !== 0n && P < 0n) fl -= 1n;
  const F = P - fl * Q;
  let a = 0n;
  let b = 1n;
  let c = 1n;
  let d = 1n;
  while (b + d <= D) {
    const cmp = (a + c) * Q - F * (b + d);
    if (cmp === 0n) return a + c + fl * (b + d) + '/' + (b + d);
    if (cmp < 0n) {
      let t = (F * b - a * Q - 1n) / (c * Q - d * F);
      const cap = (D - b) / d;
      if (cap < t) t = cap;
      a += t * c;
      b += t * d;
    } else {
      let t = (c * Q - d * F - 1n) / (F * b - a * Q);
      const cap = (D - d) / b;
      if (cap < t) t = cap;
      c += t * a;
      d += t * b;
    }
  }
  const lo = (F * b - a * Q) * d;
  const hi = (c * Q - F * d) * b;
  let pickLow;
  if (lo !== hi) pickLow = lo < hi;
  else pickLow = b <= d;
  return pickLow ? a + fl * b + '/' + b : c + fl * d + '/' + d;
}
