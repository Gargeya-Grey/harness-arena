function runLengthDecode(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] >= '0' && s[j] <= '9') j += 1;
    const digits = s.slice(i, j);
    if (digits === '' || digits[0] === '0' || j >= s.length) return null;
    out += s[j].repeat(Number(digits));
    i = j + 1;
  }
  return out;
}
