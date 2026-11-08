import { displayWidth, joinTokens, tokenize } from './tokens.mjs';

// Cuts a line to `width` columns and ends it with the ellipsis. The ellipsis counts with its own width,
// and is left out when it is wider than `width`. A character that does not fit whole is dropped.
// Colour codes in the part that was cut off are kept, after the ellipsis, so a style is never left open.
export function truncate(line, width, ellipsis) {
  if (displayWidth(line) <= width) return line;
  const mark = displayWidth(ellipsis) <= width ? ellipsis : '';
  const room = width - displayWidth(mark);
  const kept = [];
  const after = [];
  let used = 0;
  let cut = false;
  for (const token of tokenize(line)) {
    if (token.esc) (cut ? after : kept).push(token);
    else if (!cut && used + token.width <= room) {
      kept.push(token);
      used += token.width;
    } else cut = true;
  }
  return joinTokens(kept) + mark + joinTokens(after);
}
