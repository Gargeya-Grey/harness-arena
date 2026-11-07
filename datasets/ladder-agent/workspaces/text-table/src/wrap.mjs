import { displayWidth, tokenize } from './tokens.mjs';

// Breaks one line into lines of at most `width` columns, at spaces.
export function wrapLine(line, width) {
  const lines = [];
  let current = '';
  for (const word of line.split(' ').filter(Boolean)) {
    if (current && displayWidth(current) + 1 + displayWidth(word) <= width) {
      current += ` ${word}`;
      continue;
    }
    if (current) lines.push(current);
    if (displayWidth(word) <= width) {
      current = word;
      continue;
    }
    let piece = '';
    for (const token of tokenize(word)) {
      if (displayWidth(piece) + token.width > width) {
        lines.push(piece);
        piece = '';
      }
      piece += token.text;
    }
    current = piece;
  }
  lines.push(current);
  return lines;
}
