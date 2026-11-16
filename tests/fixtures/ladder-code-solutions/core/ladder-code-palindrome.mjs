function isPalindrome(s) {
  const t = s.toLowerCase().replace(/[^\p{L}\p{Nd}]/gu, '');
  return t === [...t].reverse().join('');
}
