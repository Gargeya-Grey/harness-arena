import { displayWidth } from './tokens.mjs';

// Pads a line with spaces to `width` columns. When a centred line has an odd gap, the extra space goes to the right.
export function pad(line, width, align) {
  const gap = Math.max(0, width - displayWidth(line));
  if (align === 'right') return ' '.repeat(gap) + line;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + line + ' '.repeat(gap - left);
  }
  return line + ' '.repeat(gap);
}
