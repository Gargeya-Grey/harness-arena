// How many terminal columns a character takes.
const ZERO = [
  [0x0300, 0x036f], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x2060, 0x2060],
  [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f],
];
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f1e6, 0x1f1ff], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];
const inRanges = (cp, ranges) => ranges.some(([from, to]) => cp >= from && cp <= to);

export function codePointWidth(cp) {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (inRanges(cp, ZERO)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
}

// A cluster is what the eye sees as one character: a base with its marks, a joined emoji, a flag.
// It takes the width of its widest part; a variation selector 16 (emoji style) makes it 2.
export function clusterWidth(cluster) {
  let width = 0;
  for (const ch of cluster) width = Math.max(width, codePointWidth(ch.codePointAt(0)));
  return cluster.includes('️') ? 2 : width;
}
