function countDistinctNeighbours(lo, hi, k) {
  let count = 0;
  const end = Number(hi);
  for (let x = Number(lo); x <= end; x += 1) {
    const s = String(x);
    let sum = 0;
    let ok = true;
    for (let i = 0; i < s.length; i += 1) {
      if (i > 0 && s[i] === s[i - 1]) { ok = false; break; }
      sum += s.charCodeAt(i) - 48;
    }
    if (ok && sum % k === 0) count += 1;
  }
  return String(count);
}
