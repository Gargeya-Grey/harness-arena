function countAvoiding(k, patterns, n) {
  const MOD = 1000000007;
  const letters = 'abcd'.slice(0, k);
  const used = patterns.filter((p) => [...p].every((c) => letters.includes(c)));
  if (used.includes('')) return '0';
  const keep = used.reduce((m, p) => Math.max(m, p.length), 1) - 1;
  let states = new Map([['', 1]]);
  const steps = Number(BigInt(n));
  for (let step = 0; step < steps; step += 1) {
    const next = new Map();
    for (const [tail, ways] of states) {
      for (const c of letters) {
        const text = tail + c;
        if (used.some((p) => text.endsWith(p))) continue;
        const key = keep === 0 ? '' : text.slice(-keep);
        next.set(key, ((next.get(key) || 0) + ways) % MOD);
      }
    }
    states = next;
  }
  let total = 0;
  for (const ways of states.values()) total = (total + ways) % MOD;
  return String(total);
}
