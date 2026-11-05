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
    const digits = (m[2] || '') + (m[3] ? m[3].repeat(Math.ceil(12 / m[3].length)) : '');
    let n = BigInt(m[1] + digits);
    const d = 10n ** BigInt(digits.length);
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
