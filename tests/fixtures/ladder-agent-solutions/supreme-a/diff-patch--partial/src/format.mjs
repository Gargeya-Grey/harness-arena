import { diffLines } from './myers.mjs';
import { splitLines } from './lines.mjs';

const MARK = { equal: ' ', delete: '-', insert: '+' };

function range(start, count) {
  return count === 1 ? `${start}` : `${start},${count}`;
}

export function unifiedDiff(oldText, newText, options = {}) {
  if (typeof oldText !== 'string' || typeof newText !== 'string') throw new TypeError('texts must be strings');
  const { oldName = 'a', newName = 'b', context = 3 } = options;
  if (!Number.isInteger(context) || context < 0) throw new RangeError('context must be an integer >= 0');
  const ops = diffLines(splitLines(oldText), splitLines(newText));

  const runs = [];
  for (let i = 0; i < ops.length; ) {
    if (ops[i].type === 'equal') {
      i += 1;
      continue;
    }
    const from = i;
    while (i < ops.length && ops[i].type !== 'equal') i += 1;
    runs.push([from, i]);
  }
  if (runs.length === 0) return '';

  const hunks = [];
  let prevEnd = -1;
  for (const [from, to] of runs) {
    const hi = Math.min(ops.length, to + context);
    if (hunks.length > 0 && from - prevEnd < 2 * context) hunks.at(-1)[1] = hi;
    else hunks.push([Math.max(0, from - context), hi]);
    prevEnd = to;
  }

  const oldBefore = [0];
  const newBefore = [0];
  for (const op of ops) {
    oldBefore.push(oldBefore.at(-1) + (op.type === 'insert' ? 0 : 1));
    newBefore.push(newBefore.at(-1) + (op.type === 'delete' ? 0 : 1));
  }

  let out = `--- ${oldName}\n+++ ${newName}\n`;
  for (const [lo, hi] of hunks) {
    const oldCount = oldBefore[hi] - oldBefore[lo];
    const newCount = newBefore[hi] - newBefore[lo];
    const oldStart = oldCount === 0 ? oldBefore[lo] : oldBefore[lo] + 1;
    const newStart = newCount === 0 ? newBefore[lo] : newBefore[lo] + 1;
    out += `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@\n`;
    for (const op of ops.slice(lo, hi)) {
      const bare = op.line.endsWith('\n') ? op.line.slice(0, -1).trimEnd() : op.line;
      out += `${MARK[op.type]}${bare}\n`;
      if (!op.line.endsWith('\n')) out += '\\ No newline at end of file\n';
    }
  }
  return out;
}
