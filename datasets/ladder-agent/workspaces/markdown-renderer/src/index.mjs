import { splitLines } from './text.mjs';
import { parseBlocks } from './blocks.mjs';
import { renderBlocks } from './html.mjs';

/** Markdown subset to HTML. SPEC.md describes every rule. */
export function render(source) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  const { blocks, refs } = parseBlocks(splitLines(source));
  return renderBlocks(blocks, refs);
}
