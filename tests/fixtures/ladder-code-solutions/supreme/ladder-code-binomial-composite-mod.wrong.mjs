function binomialMod(n, k, m) {
  // Lucas for each prime that divides m, then the Chinese remainder theorem.
  // Right when m has no square factor; for p^e with e > 1 it only knows the value modulo p.
  let N = BigInt(n);
  let K = BigInt(k);
  const primes = [];
  let rest = m;
  for (let p = 2; p * p <= rest; p += 1) {
    if (rest % p !== 0) continue;
    primes.push(p);
    while (rest % p === 0) rest /= p;
  }
  if (rest > 1) primes.push(rest);
  const powmod = (b, e, p) => {
    let result = 1;
    b %= p;
    for (; e > 0; e >>= 1) {
      if (e & 1) result = (result * b) % p;
      b = (b * b) % p;
    }
    return result;
  };
  const lucas = (p) => {
    const fact = new Int32Array(p);
    fact[0] = 1;
    for (let i = 1; i < p; i += 1) fact[i] = (fact[i - 1] * i) % p;
    const bp = BigInt(p);
    let a = N;
    let b = K;
    let result = 1;
    while (a > 0n || b > 0n) {
      const x = Number(a % bp);
      const y = Number(b % bp);
      if (y > x) return 0;
      const c = (((fact[x] * powmod(fact[y], p - 2, p)) % p) * powmod(fact[x - y], p - 2, p)) % p;
      result = (result * c) % p;
      a /= bp;
      b /= bp;
    }
    return result;
  };
  let residue = 0;
  let modulus = 1;
  for (const p of primes) {
    const part = lucas(p);
    for (let t = 0; t < p; t += 1) {
      if ((residue + modulus * t) % p === part) {
        residue += modulus * t;
        break;
      }
    }
    modulus *= p;
  }
  return m === 1 ? 0 : residue % m;
}
