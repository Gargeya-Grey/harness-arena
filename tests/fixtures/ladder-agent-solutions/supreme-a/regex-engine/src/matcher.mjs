import { OP } from './compiler.mjs';
import { isWordUnit, otherCase } from './units.mjs';

function inRanges(ranges, code) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (code < ranges[mid][0]) hi = mid - 1;
    else if (code > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The first match in priority order that starts at the smallest index >= from; slots are [start0, end0, start1, end1, ...]. */
export function search(program, text, from) {
  const { ops, slots, ignoreCase, multiline, dotAll } = program;
  const len = text.length;
  const mark = new Int32Array(ops.length).fill(-1);
  const stack = [];
  const blank = new Array(slots).fill(-1);
  let gen = 0;
  let clist = [];
  let nlist = [];
  let best = null;

  const wordAt = (index) => index >= 0 && index < len && isWordUnit(text.charCodeAt(index));
  const assertion = (kind, pos) => {
    switch (kind) {
      case 'bol': return pos === 0 || (multiline && text.charCodeAt(pos - 1) === 10);
      case 'eol': return pos === len || (multiline && text.charCodeAt(pos) === 10);
      case 'wb': return wordAt(pos - 1) !== wordAt(pos);
      default: return wordAt(pos - 1) === wordAt(pos);
    }
  };

  function add(list, pc0, caps0, pos) {
    stack.push(pc0, caps0);
    while (stack.length) {
      let caps = stack.pop();
      let pc = stack.pop();
      for (;;) {
        if (mark[pc] === gen) break;
        mark[pc] = gen;
        const op = ops[pc];
        if (op.k === OP.JMP) {
          pc = op.x;
        } else if (op.k === OP.SPLIT) {
          stack.push(op.y, caps);
          pc = op.x;
        } else if (op.k === OP.SAVE) {
          caps = caps.slice();
          caps[op.n] = pos;
          pc += 1;
        } else if (op.k === OP.ASSERT) {
          if (!assertion(op.a, pos)) break;
          pc += 1;
        } else {
          list.push(pc, caps);
          break;
        }
      }
    }
  }

  function accepts(op, code) {
    if (op.k === OP.CHAR) return code === op.c || (ignoreCase && code === otherCase(op.c));
    if (op.k === OP.ANY) return dotAll || code !== 10;
    const hit = inRanges(op.ranges, code) || (ignoreCase && inRanges(op.ranges, otherCase(code)));
    return hit !== op.neg;
  }

  for (let pos = from; pos <= len; pos += 1) {
    gen = pos + 1;
    if (best === null) add(clist, 0, blank, pos);
    if (clist.length === 0 && best !== null) break;
    const code = pos < len ? text.charCodeAt(pos) : -1;
    gen = pos + 2;
    for (let t = 0; t < clist.length; t += 2) {
      const op = ops[clist[t]];
      if (op.k === OP.MATCH) {
        best = clist[t + 1];
        break;
      }
      if (code >= 0 && accepts(op, code)) add(nlist, clist[t] + 1, clist[t + 1], pos + 1);
    }
    [clist, nlist] = [nlist, clist];
    nlist.length = 0;
  }
  return best;
}
