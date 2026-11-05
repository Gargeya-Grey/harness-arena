function humanizeDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 0) return null;
  if (seconds === 0) return '0s';
  const parts = [];
  let rest = seconds;
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(`${n}${unit}`);
  }
  return parts.join(' ');
}
