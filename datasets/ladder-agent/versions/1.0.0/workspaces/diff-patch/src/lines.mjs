/** Cuts a text into lines; each line keeps its newline, and the last line has none if the text does not end with one. */
export function splitLines(text) {
  const lines = [];
  let from = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', from)) {
    lines.push(text.slice(from, at + 1));
    from = at + 1;
  }
  if (from < text.length) lines.push(text.slice(from));
  return lines;
}

export function joinLines(lines) {
  return lines.join('');
}
