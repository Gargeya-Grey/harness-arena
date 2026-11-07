import { escapeHtml } from './text.mjs';
import { renderInline } from './inline.mjs';

function renderItem(item, loose, refs) {
  if (!item.blocks.length) return '<li></li>\n';
  if (loose) return `<li>\n${renderBlocks(item.blocks, refs)}</li>\n`;
  let out = '<li>';
  for (const block of item.blocks) {
    if (block.type === 'p') {
      out += renderInline(block.text.replace(/[ \t]+$/, ''), refs);
    } else {
      if (!out.endsWith('\n')) out += '\n';
      out += renderBlocks([block], refs);
    }
  }
  return `${out}</li>\n`;
}

function renderBlock(block, refs) {
  switch (block.type) {
    case 'p':
      return `<p>${renderInline(block.text.replace(/[ \t]+$/, ''), refs)}</p>\n`;
    case 'h':
      return `<h${block.level}>${renderInline(block.text.replace(/[ \t]+$/, ''), refs)}</h${block.level}>\n`;
    case 'hr':
      return '<hr>\n';
    case 'code': {
      const language = block.info.split(/\s+/)[0];
      const attribute = language ? ` class="language-${escapeHtml(language)}"` : '';
      return `<pre><code${attribute}>${escapeHtml(block.text)}</code></pre>\n`;
    }
    case 'quote':
      return `<blockquote>\n${renderBlocks(block.blocks, refs)}</blockquote>\n`;
    default: {
      const tag = block.ordered ? 'ol' : 'ul';
      const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
      const items = block.items.map((item) => renderItem(item, block.loose, refs)).join('');
      return `<${tag}${start}>\n${items}</${tag}>\n`;
    }
  }
}

export function renderBlocks(blocks, refs) {
  return blocks.map((block) => renderBlock(block, refs)).join('');
}
