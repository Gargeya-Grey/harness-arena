// renderBlocks(blocks, refs) -> the HTML text of the document. SPEC.md section 6 gives the exact output.
// It reads what parseBlocks() produced and calls renderInline() for the text of a paragraph or heading.
import { renderInline } from './inline.mjs';

export function renderBlocks(blocks, refs) {
  void blocks;
  void refs;
  void renderInline;
  throw new Error('not implemented: renderBlocks');
}
