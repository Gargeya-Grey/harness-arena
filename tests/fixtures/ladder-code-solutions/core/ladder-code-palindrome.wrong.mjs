function isPalindrome(s) {
  const t = s.toLowerCase().replace(/[^a-z]/g, '');
  return t === [...t].reverse().join('');
}
