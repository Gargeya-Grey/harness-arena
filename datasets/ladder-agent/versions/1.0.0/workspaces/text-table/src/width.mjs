// How many terminal columns a character takes.
const WIDE = [[0x3041, 0x30ff], [0x4e00, 0x9fff]];
const inRanges = (cp, ranges) => ranges.some(([from, to]) => cp >= from && cp <= to);

export function codePointWidth(cp) {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
}

// The width of a cluster, the way the eye sees one character.
export function clusterWidth(cluster) {
  let width = 0;
  for (const ch of cluster) width += codePointWidth(ch.codePointAt(0));
  return width;
}
