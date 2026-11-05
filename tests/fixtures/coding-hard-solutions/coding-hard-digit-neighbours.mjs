function countDistinctNeighbours(lo, hi, k) {
  const upTo = (s) => {
    const d = s.split('').map(Number);
    const L = d.length;
    const memo = new Map();
    const go = (pos, prev, sum, tight, started) => {
      if (pos === L) return sum === 0 ? 1n : 0n;
      const key = pos + ',' + prev + ',' + sum + ',' + (tight ? 1 : 0) + ',' + (started ? 1 : 0);
      if (memo.has(key)) return memo.get(key);
      let total = 0n;
      const limit = tight ? d[pos] : 9;
      for (let c = 0; c <= limit; c += 1) {
        if (started && c === prev) continue;
        const nowStarted = started || c !== 0;
        total += go(pos + 1, nowStarted ? c : -1, (sum + c) % k, tight && c === limit, nowStarted);
      }
      memo.set(key, total);
      return total;
    };
    return go(0, -1, 0, true, false);
  };
  const low = BigInt(lo);
  const high = BigInt(hi);
  if (low > high) return '0';
  const below = low === 0n ? 0n : upTo((low - 1n).toString());
  return (upTo(high.toString()) - below).toString();
}
