function wordCount(text) {
  const counts = {};
  for (const word of text.toLowerCase().match(/[a-z]+/g) || []) counts[word] = (counts[word] || 0) + 1;
  return counts;
}
