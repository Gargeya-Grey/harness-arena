import { joinTokens, tokenize } from './tokens.mjs';

const isSpace = (token) => !token.esc && token.text === ' ';
const widthOf = (tokens) => tokens.reduce((sum, token) => sum + token.width, 0);

// Pieces of a line: runs of spaces and words, in order. A colour code belongs to the word it touches.
function pieces(tokens) {
  const out = [];
  for (const token of tokens) {
    const space = isSpace(token);
    const last = out.at(-1);
    if (last && last.space === space) last.tokens.push(token);
    else out.push({ space, tokens: [token] });
  }
  return out;
}

// A word wider than the column is cut into chunks that fit.
function chunks(tokens, width) {
  const out = [[]];
  let used = 0;
  for (const token of tokens) {
    if (used + token.width > width && used > 0) {
      out.push([]);
      used = 0;
    }
    out.at(-1).push(token);
    used += token.width;
  }
  return out;
}

// Breaks one line into lines of at most `width` columns, at spaces. The spaces at a break are dropped,
// the spaces inside a line stay as they are, and so does the indent at the start of the first line.
export function wrapLine(line, width) {
  const lines = [];
  let current = [];
  let pending = [];
  const place = (word) => {
    const parts = chunks(word, width);
    parts.slice(0, -1).forEach((part) => lines.push(part));
    current = parts.at(-1);
  };
  for (const piece of pieces(tokenize(line))) {
    if (piece.space) {
      pending = piece.tokens;
      continue;
    }
    if (current.length === 0 && lines.length === 0) {
      current = [...pending];
      pending = [];
      if (widthOf(current) + widthOf(piece.tokens) <= width) current.push(...piece.tokens);
      else {
        const parts = chunks(piece.tokens, width);
        parts.slice(0, -1).forEach((part) => lines.push(part));
        current = parts.at(-1);
      }
    } else if (widthOf(current) + widthOf(pending) + widthOf(piece.tokens) <= width) {
      current.push(...pending, ...piece.tokens);
    } else {
      lines.push(current);
      place(piece.tokens);
    }
    pending = [];
  }
  lines.push(current);
  return lines.map(joinTokens);
}
