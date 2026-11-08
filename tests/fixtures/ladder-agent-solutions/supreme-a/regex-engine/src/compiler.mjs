import { RegexSyntaxError } from './errors.mjs';

export const OP = { CHAR: 0, ANY: 1, SET: 2, SPLIT: 3, JMP: 4, SAVE: 5, ASSERT: 6, MATCH: 7 };
const MAX_ATOMS = 10000;
const CAP = 1e12;

/** Atoms of the pattern with every counted repeat written out (SPEC.md, Size). */
function atoms(node) {
  switch (node.t) {
    case 'char': case 'any': case 'set': case 'assert': return 1;
    case 'empty': return 0;
    case 'group': return atoms(node.node);
    case 'cat': return node.items.reduce((sum, item) => Math.min(sum + atoms(item), CAP), 0);
    case 'alt': return node.alts.reduce((sum, item) => Math.min(sum + atoms(item), CAP), 0);
    case 'rep': {
      const copies = node.max === Infinity ? node.min + 1 : node.max;
      return Math.min(atoms(node.node) * copies, CAP);
    }
    default: throw new Error(`unknown node ${node.t}`);
  }
}

function mergeRanges(ranges) {
  const sorted = ranges.map((pair) => [...pair]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const pair of sorted) {
    const last = out.at(-1);
    if (last && pair[0] <= last[1] + 1) last[1] = Math.max(last[1], pair[1]);
    else out.push(pair);
  }
  return out;
}

export function build(tree, groupCount, flags) {
  if (atoms(tree) > MAX_ATOMS) throw new RegexSyntaxError('too-large');
  const ops = [];
  const emit = (op) => ops.push(op) - 1;

  function gen(node) {
    switch (node.t) {
      case 'empty': return;
      case 'char': emit({ k: OP.CHAR, c: node.c }); return;
      case 'any': emit({ k: OP.ANY }); return;
      case 'set': emit({ k: OP.SET, ranges: mergeRanges(node.ranges), neg: node.neg }); return;
      case 'assert': emit({ k: OP.ASSERT, a: node.k }); return;
      case 'group':
        if (node.index === null) return gen(node.node);
        emit({ k: OP.SAVE, n: 2 * node.index });
        gen(node.node);
        emit({ k: OP.SAVE, n: 2 * node.index + 1 });
        return;
      case 'cat': node.items.forEach(gen); return;
      case 'alt': {
        const jumps = [];
        node.alts.forEach((alt, index) => {
          if (index < node.alts.length - 1) {
            const split = emit({ k: OP.SPLIT, x: 0, y: 0 });
            ops[split].x = ops.length;
            gen(alt);
            jumps.push(emit({ k: OP.JMP, x: 0 }));
            ops[split].y = ops.length;
          } else gen(alt);
        });
        for (const jump of jumps) ops[jump].x = ops.length;
        return;
      }
      case 'rep': {
        if (node.max === 0) return;
        for (let n = 0; n < node.min; n += 1) gen(node.node);
        if (node.max === Infinity) {
          const split = emit({ k: OP.SPLIT, x: 0, y: 0 });
          const body = ops.length;
          gen(node.node);
          emit({ k: OP.JMP, x: split });
          const exit = ops.length;
          [ops[split].x, ops[split].y] = node.lazy ? [exit, body] : [body, exit];
          return;
        }
        const splits = [];
        for (let n = node.min; n < node.max; n += 1) {
          const split = emit({ k: OP.SPLIT, x: 0, y: 0 });
          splits.push([split, ops.length]);
          gen(node.node);
        }
        const exit = ops.length;
        for (const [split, body] of splits) [ops[split].x, ops[split].y] = node.lazy ? [exit, body] : [body, exit];
        return;
      }
      default: throw new Error(`unknown node ${node.t}`);
    }
  }

  emit({ k: OP.SAVE, n: 0 });
  gen(tree);
  emit({ k: OP.SAVE, n: 1 });
  emit({ k: OP.MATCH });
  return { ops, slots: 2 * (groupCount + 1), ignoreCase: flags.includes('i'), multiline: flags.includes('m'), dotAll: flags.includes('s') };
}
