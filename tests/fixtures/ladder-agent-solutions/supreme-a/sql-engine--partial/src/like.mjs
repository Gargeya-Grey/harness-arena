export function like(rawText, rawPattern) {
  const text = rawText.toLowerCase();
  const pattern = rawPattern.toLowerCase();
  let t = 0;
  let p = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '%') {
      star = p;
      p += 1;
      mark = t;
    } else if (p < pattern.length && (pattern[p] === '_' || pattern[p] === text[t])) {
      t += 1;
      p += 1;
    } else if (star >= 0) {
      p = star + 1;
      mark += 1;
      t = mark;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '%') p += 1;
  return p === pattern.length;
}
