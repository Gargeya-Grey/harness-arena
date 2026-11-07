import { SGR, displayWidth } from './tokens.mjs';

const TAB_STOP = 4;

function toText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// A tab moves to the next multiple of 4 columns, counted from the start of the line.
function expandTabs(line) {
  const parts = line.split('\t');
  let out = parts[0];
  for (let index = 1; index < parts.length; index += 1) {
    out += ' '.repeat(TAB_STOP - (displayWidth(out) % TAB_STOP)) + parts[index];
  }
  return out;
}

// Control characters other than colour codes would move the cursor: they are dropped.
const stripControls = (line) => line.split(SGR).map((part, index) => (index % 2 === 1 ? part : part.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''))).join('');

// A cell value as lines of text.
export function cellLines(value) {
  return toText(value).replace(/\r\n?/g, '\n').split('\n').map(expandTabs).map(stripControls);
}
