function sumRepeatingDecimals(terms) {
  const gcd = (x, y) => {
    let u = x < 0n ? -x : x;
    let v = y < 0n ? -y : y;
    while (v) [u, v] = [v, u % v];
    return u;
  };
  let num = 0n;
  let den = 1n;
  for (const term of terms) {
    const negative = term[0] === '-';
    const body = negative ? term.slice(1) : term;
    const m = /^(\d+)(?:\.(\d*)(?:\((\d+)\))?)?$/.exec(body);
    const whole = BigInt(m[1]);
    const fixed = m[2] || '';
    const cycle = m[3] || '';
    let n = whole;
    let d = 1n;
    if (fixed) {
      d = 10n ** BigInt(fixed.length);
      n = whole * d + BigInt(fixed);
    }
    if (cycle) {
      const r = 10n ** BigInt(cycle.length) - 1n;
      n = n * r + BigInt(cycle);
      d *= r;
    }
    if (negative) n = -n;
    num = num * d + n * den;
    den *= d;
    const g = gcd(num, den);
    num /= g;
    den /= g;
  }
  if (num === 0n) return '0';
  return den === 1n ? num.toString() : num + '/' + den;
}
