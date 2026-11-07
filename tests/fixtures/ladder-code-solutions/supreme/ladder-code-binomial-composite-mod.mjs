function binomialMod(nText, kText, m) {
  if (m === 1) return 0;
  const n = BigInt(nText);
  const k = BigInt(kText);
  const r = n - k;

  const mulmod = (a, b, mod) => (a * b) % mod; // both below 2e6 here, so exact
  const powmod = (base, exp, mod) => {
    let result = 1 % mod;
    let b = base % mod;
    let e = exp;
    while (e > 0n) {
      if (e & 1n) result = mulmod(result, b, mod);
      b = mulmod(b, b, mod);
      e >>= 1n;
    }
    return result;
  };
  const inverse = (a, mod) => {
    let [oldR, rr] = [a % mod, mod];
    let [oldS, s] = [1, 0];
    while (rr !== 0) {
      const quotient = Math.floor(oldR / rr);
      [oldR, rr] = [rr, oldR - quotient * rr];
      [oldS, s] = [s, oldS - quotient * s];
    }
    return ((oldS % mod) + mod) % mod;
  };
  const valuation = (value, p) => {
    let total = 0n;
    const bp = BigInt(p);
    for (let q = value / bp; q > 0n; q /= bp) total += q;
    return total;
  };

  // C(n, k) mod p^e.
  const modPrimePower = (p, e, pe) => {
    const unit = new Int32Array(pe);
    unit[0] = 1 % pe;
    for (let i = 1; i < pe; i += 1) unit[i] = i % p === 0 ? unit[i - 1] : mulmod(unit[i - 1], i, pe);
    const full = unit[pe - 1];
    const bp = BigInt(p);
    const bpe = BigInt(pe);
    // n! with every factor p removed, modulo p^e.
    const freeFactorial = (value) => {
      let result = 1 % pe;
      for (let v = value; v > 0n; v /= bp) {
        result = mulmod(result, powmod(full, v / bpe, pe), pe);
        result = mulmod(result, unit[Number(v % bpe)], pe);
      }
      return result;
    };
    const exponent = valuation(n, p) - valuation(k, p) - valuation(r, p);
    if (exponent >= BigInt(e)) return 0;
    let value = freeFactorial(n);
    value = mulmod(value, inverse(mulmod(freeFactorial(k), freeFactorial(r), pe), pe), pe);
    for (let i = 0n; i < exponent; i += 1n) value = mulmod(value, p, pe);
    return value;
  };

  // Chinese remainder theorem over the prime powers of m.
  const powers = [];
  let rest = m;
  for (let p = 2; p * p <= rest; p += 1) {
    if (rest % p !== 0) continue;
    let e = 0;
    let pe = 1;
    while (rest % p === 0) {
      rest /= p;
      e += 1;
      pe *= p;
    }
    powers.push([p, e, pe]);
  }
  if (rest > 1) powers.push([rest, 1, rest]);
  let residue = 0;
  let modulus = 1;
  for (const [p, e, pe] of powers) {
    const part = modPrimePower(p, e, pe);
    const step = (((part - residue) % pe) + pe) % pe;
    const turns = (step * inverse(modulus % pe, pe)) % pe;
    residue += modulus * turns;
    modulus *= pe;
  }
  return residue % m;
}
