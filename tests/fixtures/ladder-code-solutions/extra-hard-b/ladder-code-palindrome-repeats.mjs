function repeatedPalindromes(source, minLen) {
  let s;
  let alpha = 26;
  if (typeof source === 'string') {
    s = new Uint8Array(source.length);
    for (let i = 0; i < source.length; i += 1) s[i] = source.charCodeAt(i) - 97;
  } else {
    const { n, alphabet, runMax, seed } = source;
    alpha = alphabet;
    s = new Uint8Array(n);
    let x = seed;
    let at = 0;
    while (at < n) {
      x = (x * 48271 + 11) % 2147483647;
      const letter = x % alphabet;
      x = (x * 48271 + 11) % 2147483647;
      const length = Math.min((x % runMax) + 1, n - at);
      s.fill(letter, at, at + length);
      at += length;
    }
  }
  const n = s.length;

  // Palindromic tree: node 0 has length -1, node 1 has length 0.
  const len = new Int32Array(n + 2);
  const link = new Int32Array(n + 2);
  const next = new Int32Array((n + 2) * alpha);
  const count = new Float64Array(n + 2);
  len[0] = -1;
  len[1] = 0;
  link[0] = 0;
  link[1] = 0;
  let size = 2;
  let last = 1;
  for (let i = 0; i < n; i += 1) {
    const c = s[i];
    let cur = last;
    while (i - len[cur] - 1 < 0 || s[i - len[cur] - 1] !== c) cur = link[cur];
    if (next[cur * alpha + c] === 0) {
      const node = size;
      size += 1;
      len[node] = len[cur] + 2;
      if (len[node] === 1) link[node] = 1;
      else {
        let p = link[cur];
        while (i - len[p] - 1 < 0 || s[i - len[p] - 1] !== c) p = link[p];
        link[node] = next[p * alpha + c];
      }
      next[cur * alpha + c] = node;
    }
    last = next[cur * alpha + c];
    count[last] += 1;
  }
  // Every occurrence of a palindrome is also an occurrence of its longest proper palindromic suffix.
  for (let v = size - 1; v >= 2; v -= 1) count[link[v]] += count[v];
  let answer = 0;
  for (let v = 2; v < size; v += 1) if (len[v] >= minLen && count[v] >= 2) answer += 1;
  return answer;
}
