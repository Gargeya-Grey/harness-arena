function countNotDivisible(lo, hi, primes) {
  let count = 0;
  const end = Number(hi);
  for (let x = Number(lo); x <= end; x += 1) {
    let ok = true;
    for (let i = 0; i < primes.length; i += 1) {
      if (x % primes[i] === 0) { ok = false; break; }
    }
    if (ok) count += 1;
  }
  return String(count);
}
