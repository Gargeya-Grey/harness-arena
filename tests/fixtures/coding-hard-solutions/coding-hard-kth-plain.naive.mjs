function kthPlainNumber(k) {
  let remaining = Number(k);
  for (let x = 1; ; x += 1) {
    const s = Math.round(Math.sqrt(x));
    const c = Math.round(Math.cbrt(x));
    if (s * s === x || c * c * c === x) continue;
    remaining -= 1;
    if (remaining === 0) return String(x);
  }
}
