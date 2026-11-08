// Correct, but visits every palindromic occurrence (centre and radius) and counts it in a map: about the sum of all radii.
function repeatedPalindromes(source, minLen) {
  let text;
  if (typeof source === 'string') text = source;
  else {
    const { n, alphabet, runMax, seed } = source;
    const out = [];
    let x = seed;
    let length = 0;
    while (length < n) {
      x = (x * 48271 + 11) % 2147483647;
      const letter = String.fromCharCode(97 + (x % alphabet));
      x = (x * 48271 + 11) % 2147483647;
      const run = Math.min((x % runMax) + 1, n - length);
      out.push(letter.repeat(run));
      length += run;
    }
    text = out.join('');
  }
  const n = text.length;
  const seen = new Map();
  for (let centre = 0; centre < 2 * n - 1; centre += 1) {
    let l = centre >> 1;
    let r = l + (centre & 1);
    while (l >= 0 && r < n && text[l] === text[r]) {
      const key = text.slice(l, r + 1);
      seen.set(key, (seen.get(key) || 0) + 1);
      l -= 1;
      r += 1;
    }
  }
  let answer = 0;
  for (const [key, times] of seen) if (key.length >= minLen && times >= 2) answer += 1;
  return answer;
}
