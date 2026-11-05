function squareDigit(n) {
  let remaining = Number(n);
  for (let k = 1; ; k += 1) {
    const s = String(k * k);
    if (remaining <= s.length) return s[remaining - 1];
    remaining -= s.length;
  }
}
