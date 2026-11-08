function primesUpTo(n) {
  const out = [];
  for (let k = 2; k <= n; k += 1) {
    let prime = true;
    for (let d = 2; d * d <= k; d += 1) {
      if (k % d === 0) {
        prime = false;
        break;
      }
    }
    if (prime) out.push(k);
  }
  return out;
}
