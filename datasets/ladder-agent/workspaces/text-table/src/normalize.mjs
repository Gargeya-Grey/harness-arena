import { SGR } from './tokens.mjs';

function toText(value) {
  if (value === undefined) return '';
  return String(value);
}

// Control characters other than colour codes would move the cursor: they are dropped.
const stripControls = (line) => line.split(SGR).map((part, index) => (index % 2 === 1 ? part : part.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''))).join('');

// A cell value as lines of text.
export function cellLines(value) {
  return toText(value).replaceAll('\t', ' ').split('\n').map(stripControls);
}
