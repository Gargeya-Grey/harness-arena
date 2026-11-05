function countDistinctNeighbours(lo, hi, k) {
  const upTo = (n) => {
    if (n < 0) return 0;
    const d = String(n).split('').map(Number);
    const L = d.length;
    const memo = new Map();
    const go = (pos, prev, sum, tight, started) => {
      if (pos === L) return started && sum === 0 ? 1 : 0;
      const key = pos + ',' + prev + ',' + sum + ',' + tight + ',' + started;
      if (memo.has(key)) return memo.get(key);
      let total = 0;
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
  const low = Number(lo);
  const high = Number(hi);
  if (low > high) return '0';
  return String(upTo(high) - upTo(low - 1));
}
