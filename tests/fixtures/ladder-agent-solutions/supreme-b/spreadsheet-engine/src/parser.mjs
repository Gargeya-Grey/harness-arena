import { splitRef, inGrid } from './refs.mjs';

const FAIL = Symbol('parse failure');

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= text.length) return null;
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          break;
        }
        value += text[j];
        j += 1;
      }
      tokens.push({ t: 'str', v: value });
      i = j + 1;
      continue;
    }
    const num = /(\d+(\.\d+)?|\.\d+)/y;
    num.lastIndex = i;
    const m = num.exec(text);
    if (m) {
      tokens.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    const word = /[A-Za-z_$][A-Za-z0-9_.$]*/y;
    word.lastIndex = i;
    const w = word.exec(text);
    if (w) {
      tokens.push({ t: 'word', v: w[0] });
      i += w[0].length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      tokens.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>(),:'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

const LEVELS = [['=', '<>', '<', '<=', '>', '>='], ['&'], ['+', '-'], ['*', '/'], ['^']];

export function parseFormula(text) {
  const tokens = tokenize(text);
  if (!tokens || !tokens.length) return { ok: false };
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const fail = () => {
    throw FAIL;
  };

  function binary(level) {
    if (level === LEVELS.length) return unary();
    let left = binary(level + 1);
    while (peek() && peek().t === 'op' && LEVELS[level].includes(peek().v)) {
      const op = tokens[pos].v;
      pos += 1;
      left = { t: 'bin', op, l: left, r: binary(level + 1) };
    }
    return left;
  }

  function unary() {
    if (isOp('-') || isOp('+')) {
      const op = tokens[pos].v;
      pos += 1;
      return { t: 'unary', op, x: unary() };
    }
    return primary();
  }

  function cornerAfterColon() {
    pos += 1;
    const next = peek();
    const corner = next && next.t === 'word' ? splitRef(next.v, true) : null;
    if (!corner) fail();
    pos += 1;
    return corner;
  }

  function primary() {
    const tok = tokens[pos];
    if (!tok) return fail();
    pos += 1;
    if (tok.t === 'num') return { t: 'num', v: tok.v };
    if (tok.t === 'str') return { t: 'str', v: tok.v };
    if (tok.t === 'op') {
      if (tok.v !== '(') return fail();
      const inner = binary(0);
      if (!isOp(')')) fail();
      pos += 1;
      return inner;
    }
    if (isOp('(')) {
      pos += 1;
      const args = [];
      if (isOp(')')) {
        pos += 1;
        return { t: 'call', name: tok.v.toUpperCase(), args };
      }
      for (;;) {
        args.push(binary(0));
        if (isOp(',')) {
          pos += 1;
          continue;
        }
        if (isOp(')')) {
          pos += 1;
          return { t: 'call', name: tok.v.toUpperCase(), args };
        }
        return fail();
      }
    }
    const upper = tok.v.toUpperCase();
    if (upper === 'TRUE' || upper === 'FALSE') return { t: 'bool', v: upper === 'TRUE' };
    const first = splitRef(tok.v, true);
    if (first) {
      if (isOp(':')) {
        const second = cornerAfterColon();
        const ok = inGrid(first) && inGrid(second);
        return {
          t: 'range',
          ok,
          c1: Math.min(first.col, second.col),
          c2: Math.max(first.col, second.col),
          r1: Math.min(first.row, second.row),
          r2: Math.max(first.row, second.row),
        };
      }
      return { t: 'ref', col: first.col, row: first.row };
    }
    return { t: 'name', name: tok.v };
  }

  try {
    const ast = binary(0);
    if (pos < tokens.length) fail();
    return { ok: true, ast };
  } catch (error) {
    if (error === FAIL) return { ok: false };
    throw error;
  }
}

/** In-grid mentions of an AST: single cells and whole ranges (a range with a corner outside mentions nothing). */
export function references(ast) {
  const cells = [];
  const ranges = [];
  const stack = [ast];
  while (stack.length) {
    const node = stack.pop();
    if (node.t === 'ref') {
      if (inGrid(node)) cells.push({ col: node.col, row: node.row });
    } else if (node.t === 'range') {
      if (node.ok) ranges.push({ c1: node.c1, r1: node.r1, c2: node.c2, r2: node.r2 });
    } else if (node.t === 'bin') {
      stack.push(node.l, node.r);
    } else if (node.t === 'unary') {
      stack.push(node.x);
    } else if (node.t === 'call') {
      stack.push(...node.args);
    }
  }
  return { cells, ranges };
}
