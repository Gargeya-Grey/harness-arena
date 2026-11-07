import { PatchError } from './errors.mjs';

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/;
const TYPES = { ' ': 'equal', '-': 'delete', '+': 'insert' };

const nameOf = (line) => {
  const rest = line.slice(4);
  return rest;
};

export function parsePatch(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let i = 0;
  while (i < lines.length && !lines[i].startsWith('--- ')) i += 1;
  if (i >= lines.length) return { oldName: null, newName: null, hunks: [] };
  const oldName = nameOf(lines[i]);
  i += 1;
  if (i >= lines.length || !lines[i].startsWith('+++ ')) throw new PatchError('bad-header');
  const newName = nameOf(lines[i]);
  i += 1;

  const hunks = [];
  while (i < lines.length) {
    const match = HEADER.exec(lines[i]);
    if (!match) throw new PatchError(hunks.length === 0 ? 'bad-hunk-header' : 'bad-hunk-line', lines[i]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);
    const hunk = { oldStart: Number(match[1]), oldCount, newStart: Number(match[3]), newCount, lines: [] };
    i += 1;
    let oldSeen = 0;
    let newSeen = 0;
    let marked = false;
    const mark = () => {
      if (hunk.lines.length === 0 || marked) return;
      const last = hunk.lines.at(-1);
      last.line = last.line.slice(0, -1);
      marked = true;
    };
    while (oldSeen < oldCount || newSeen < newCount) {
      if (i >= lines.length) throw new PatchError('count-mismatch', 'input ended inside a hunk');
      const body = lines[i];
      if (body.startsWith('@@')) throw new PatchError('count-mismatch', 'hunk ended early');
      if (body[0] === '\\') {
        mark();
        i += 1;
        continue;
      }
      const type = TYPES[body[0]];
      if (type === undefined) throw new PatchError('bad-hunk-line', body);
      if (type !== 'insert') oldSeen += 1;
      if (type !== 'delete') newSeen += 1;
      if (oldSeen > oldCount || newSeen > newCount) throw new PatchError('count-mismatch', 'hunk is longer than its header');
      hunk.lines.push({ type, line: `${body.slice(1)}\n` });
      marked = false;
      i += 1;
    }
    if (i < lines.length && lines[i][0] === '\\') {
      mark();
      i += 1;
    }
    hunks.push(hunk);
  }
  return { oldName, newName, hunks };
}
