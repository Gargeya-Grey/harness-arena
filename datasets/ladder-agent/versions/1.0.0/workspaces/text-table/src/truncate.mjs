import { displayWidth, joinTokens, tokenize } from './tokens.mjs';

// Cuts a line to `width` columns and ends it with the ellipsis.
export function truncate(line, width, ellipsis) {
  if (displayWidth(line) <= width) return line;
  const kept = [];
  let used = 0;
  for (const token of tokenize(line)) {
    if (used + token.width > width - 1) break;
    kept.push(token);
    used += token.width;
  }
  return joinTokens(kept) + ellipsis;
}
