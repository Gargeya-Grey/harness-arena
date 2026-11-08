import { displayWidth } from './tokens.mjs';

// Pads a line with spaces to `width` columns.
export function pad(line, width, align) {
  const gap = Math.max(0, width - displayWidth(line));
  if (align === 'right') return ' '.repeat(gap) + line;
  if (align === 'center') {
    const right = Math.floor(gap / 2);
    return ' '.repeat(gap - right) + line + ' '.repeat(right);
  }
  return line + ' '.repeat(gap);
}
