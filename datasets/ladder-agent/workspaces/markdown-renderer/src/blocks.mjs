// parseBlocks(lines) -> { blocks, refs }.  `lines` come from splitLines() in text.mjs.
// SPEC.md sections 2 to 5. The shape of `blocks` is yours; html.mjs reads it.
// refs is a Map from normalizeLabel(label) to { dest, title } (title is null when absent); SPEC.md section 5.
export function parseBlocks(lines) {
  void lines;
  throw new Error('not implemented: parseBlocks');
}
