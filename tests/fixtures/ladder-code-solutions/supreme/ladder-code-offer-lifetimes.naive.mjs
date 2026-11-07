function offerChecksum(n, q, horizon, maxLen, xRange, seed) {
  let x = seed;
  const draw = () => {
    x = (x * 48271 + 11) % 2147483647;
    return x;
  };
  const offers = [];
  for (let i = 0; i < n; i += 1) {
    const start = draw() % horizon;
    const length = 1 + (draw() % maxLen);
    const end = Math.min(horizon, start + length);
    const slope = (draw() % 2001) - 1000;
    const base = draw() % 1000000001;
    offers.push({ start, end, slope, base });
  }
  const MOD = 1000000007;
  let h = 0;
  for (let j = 0; j < q; j += 1) {
    const time = draw() % horizon;
    const amount = draw() % (xRange + 1);
    let best = 4000000000;
    for (const o of offers) {
      if (o.start <= time && time < o.end) best = Math.min(best, o.slope * amount + o.base);
    }
    h = (h * 1000003 + ((best % MOD) + MOD) % MOD) % MOD;
  }
  return h;
}
