function squareDigit(n) {
  let N = Number(n);
  for (let d = 1; ; d += 1) {
    const a = Math.ceil(Math.sqrt(Math.pow(10, d - 1)));
    const b = Math.floor(Math.sqrt(Math.pow(10, d) - 1));
    const count = Math.max(0, b - a + 1);
    if (N > count * d) {
      N -= count * d;
      continue;
    }
    const idx = Math.floor((N - 1) / d);
    const off = (N - 1) % d;
    return String((a + idx) * (a + idx))[off];
  }
}
