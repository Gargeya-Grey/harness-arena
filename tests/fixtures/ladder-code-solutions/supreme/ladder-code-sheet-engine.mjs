function evaluateSheet(cells) {
  const LIMIT = 1e15;
  class Err {
    constructor(code) {
      this.code = code;
    }
  }
  const isErr = (v) => v instanceof Err;
  const CELL_ID = /^([A-Z])([1-9][0-9]?)$/;
  const NUMBER_CELL = /^-?\d+(\.\d+)?$/;

  const show = (x) => {
    let s = x.toFixed(6);
    if (s.includes('.')) s = s.replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
  };
  const guard = (x) => (!Number.isFinite(x) || Math.abs(x) >= LIMIT ? new Err('#VALUE!') : x);

  // Parsing of one formula into a tree; throws SYNTAX for any grammar error.
  const SYNTAX = { syntax: true };
  function parseFormula(source) {
    const tokens = [];
    let i = 0;
    while (i < source.length) {
      const c = source[i];
      if (c === ' ' || c === '\t') {
        i += 1;
      } else if (c >= '0' && c <= '9') {
        let j = i;
        while (j < source.length && source[j] >= '0' && source[j] <= '9') j += 1;
        if (source[j] === '.' && source[j + 1] >= '0' && source[j + 1] <= '9') {
          j += 1;
          while (j < source.length && source[j] >= '0' && source[j] <= '9') j += 1;
        }
        tokens.push({ k: 'num', v: Number(source.slice(i, j)) });
        i = j;
      } else if (c === '"') {
        let j = i + 1;
        let text = '';
        for (;;) {
          if (j >= source.length) throw SYNTAX;
          if (source[j] === '"') {
            if (source[j + 1] === '"') {
              text += '"';
              j += 2;
            } else break;
          } else {
            text += source[j];
            j += 1;
          }
        }
        tokens.push({ k: 'str', v: text });
        i = j + 1;
      } else if (c >= 'A' && c <= 'Z') {
        let j = i;
        while (j < source.length && source[j] >= 'A' && source[j] <= 'Z') j += 1;
        const letters = source.slice(i, j);
        let d = j;
        while (d < source.length && source[d] >= '0' && source[d] <= '9') d += 1;
        if (d > j) {
          tokens.push({ k: 'ref', v: source.slice(i, d) });
          i = d;
        } else if (source[j] === '(') {
          tokens.push({ k: 'fn', v: letters });
          i = j;
        } else throw SYNTAX;
      } else {
        const two = source.slice(i, i + 2);
        if (two === '<>' || two === '<=' || two === '>=') {
          tokens.push({ k: 'op', v: two });
          i += 2;
        } else if ('()+-*/^&=<>,:'.includes(c)) {
          tokens.push({ k: 'op', v: c });
          i += 1;
        } else throw SYNTAX;
      }
    }
    tokens.push({ k: 'end', v: '' });
    let pos = 0;
    const isOp = (v) => tokens[pos].k === 'op' && tokens[pos].v === v;
    const expectOp = (v) => {
      if (!isOp(v)) throw SYNTAX;
      pos += 1;
    };
    function binary(next, ops) {
      let left = next();
      while (tokens[pos].k === 'op' && ops.includes(tokens[pos].v)) {
        const op = tokens[pos].v;
        pos += 1;
        left = { t: 'bin', op, l: left, r: next() };
      }
      return left;
    }
    const parseCompare = () => binary(parseConcat, ['=', '<>', '<', '<=', '>', '>=']);
    const parseConcat = () => binary(parseAdd, ['&']);
    const parseAdd = () => binary(parseMul, ['+', '-']);
    const parseMul = () => binary(parsePow, ['*', '/']);
    const parsePow = () => binary(parseUnary, ['^']);
    function parseUnary() {
      if (isOp('-')) {
        pos += 1;
        return { t: 'neg', e: parseUnary() };
      }
      return parseAtom();
    }
    function parseAtom() {
      const token = tokens[pos];
      if (token.k === 'num') {
        pos += 1;
        return { t: 'num', v: token.v };
      }
      if (token.k === 'str') {
        pos += 1;
        return { t: 'str', v: token.v };
      }
      if (token.k === 'ref') {
        pos += 1;
        if (isOp(':')) {
          pos += 1;
          if (tokens[pos].k !== 'ref') throw SYNTAX;
          pos += 1;
          return { t: 'range', a: token.v, b: tokens[pos - 1].v };
        }
        return { t: 'ref', id: token.v };
      }
      if (token.k === 'fn') {
        pos += 1;
        expectOp('(');
        const args = [];
        if (!isOp(')')) {
          args.push(parseCompare());
          while (isOp(',')) {
            pos += 1;
            args.push(parseCompare());
          }
        }
        expectOp(')');
        return { t: 'call', name: token.v, args };
      }
      if (isOp('(')) {
        pos += 1;
        const e = parseCompare();
        expectOp(')');
        return e;
      }
      throw SYNTAX;
    }
    const tree = parseCompare();
    if (tokens[pos].k !== 'end') throw SYNTAX;
    return tree;
  }

  // Read the cells.
  const ids = Object.keys(cells);
  const kind = new Map();
  const tree = new Map();
  for (const id of ids) {
    const content = cells[id];
    if (content === '') kind.set(id, 'blank');
    else if (content[0] === '=') {
      try {
        tree.set(id, parseFormula(content.slice(1)));
        kind.set(id, 'formula');
      } catch (error) {
        if (error !== SYNTAX) throw error;
        kind.set(id, 'broken');
      }
    } else kind.set(id, NUMBER_CELL.test(content) ? 'number' : 'text');
  }

  // Static dependencies: every valid cell named anywhere in a formula, in untaken branches too.
  const expand = (a, b) => {
    const A = CELL_ID.exec(a);
    const B = CELL_ID.exec(b);
    if (!A || !B) return null;
    const out = [];
    const c0 = Math.min(A[1].charCodeAt(0), B[1].charCodeAt(0));
    const c1 = Math.max(A[1].charCodeAt(0), B[1].charCodeAt(0));
    const r0 = Math.min(Number(A[2]), Number(B[2]));
    const r1 = Math.max(Number(A[2]), Number(B[2]));
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) out.push(String.fromCharCode(c) + r);
    return out;
  };
  const deps = new Map();
  const collect = (node, into) => {
    if (node.t === 'ref') {
      if (CELL_ID.test(node.id)) into.add(node.id);
    } else if (node.t === 'range') {
      for (const id of expand(node.a, node.b) || []) into.add(id);
    } else if (node.t === 'bin') {
      collect(node.l, into);
      collect(node.r, into);
    } else if (node.t === 'neg') collect(node.e, into);
    else if (node.t === 'call') for (const arg of node.args) collect(arg, into);
  };
  for (const id of ids) {
    const into = new Set();
    if (kind.get(id) === 'formula') collect(tree.get(id), into);
    deps.set(id, [...into].filter((d) => kind.has(d)));
  }
  const reach = new Map();
  for (const id of ids) {
    const seen = new Set();
    const stack = [...deps.get(id)];
    while (stack.length) {
      const d = stack.pop();
      if (seen.has(d)) continue;
      seen.add(d);
      for (const e of deps.get(d)) stack.push(e);
    }
    reach.set(id, seen);
  }
  const cyclic = new Set(ids.filter((id) => reach.get(id).has(id)));
  const poisoned = new Set(ids.filter((id) => cyclic.has(id) || [...reach.get(id)].some((d) => cyclic.has(d))));

  // Evaluation, with each cell computed once.
  const memo = new Map();
  function valueOf(id) {
    if (!kind.has(id)) return null;
    if (memo.has(id)) return memo.get(id);
    let value;
    switch (kind.get(id)) {
      case 'blank':
        value = null;
        break;
      case 'number':
        value = Number(cells[id]);
        break;
      case 'text':
        value = cells[id];
        break;
      case 'broken':
        value = new Err('#ERR!');
        break;
      default: {
        value = evaluate(tree.get(id));
        if (value === null) value = 0;
      }
    }
    memo.set(id, value);
    return value;
  }
  const toNumber = (v) => (typeof v === 'number' ? v : v === null ? 0 : new Err('#VALUE!'));
  const toText = (v) => (typeof v === 'number' ? show(v) : v === null ? '' : v);
  function lookup(id) {
    if (!CELL_ID.test(id)) return new Err('#REF!');
    return valueOf(id);
  }
  function rangeValues(node) {
    const list = expand(node.a, node.b);
    if (!list) return new Err('#REF!');
    return list.map((id) => valueOf(id));
  }
  function collectNumbers(args) {
    const numbers = [];
    for (const arg of args) {
      if (arg.t === 'range') {
        const values = rangeValues(arg);
        if (isErr(values)) return values;
        for (const v of values) {
          if (isErr(v)) return v;
          if (typeof v === 'number') numbers.push(v);
        }
      } else {
        const v = evaluate(arg);
        if (isErr(v)) return v;
        const n = toNumber(v);
        if (isErr(n)) return n;
        numbers.push(n);
      }
    }
    return numbers;
  }
  function compare(op, a, b) {
    let result;
    const aText = typeof a === 'string';
    const bText = typeof b === 'string';
    if (aText || bText) {
      if ((aText && typeof b === 'number') || (bText && typeof a === 'number')) return new Err('#VALUE!');
      const x = aText ? a : '';
      const y = bText ? b : '';
      result = op === '=' ? x === y : op === '<>' ? x !== y : op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
    } else {
      const x = a === null ? 0 : a;
      const y = b === null ? 0 : b;
      result = op === '=' ? x === y : op === '<>' ? x !== y : op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
    }
    return result ? 1 : 0;
  }
  function call(node) {
    const { name, args } = node;
    if (['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'].includes(name)) {
      const numbers = collectNumbers(args);
      if (isErr(numbers)) return numbers;
      if (name === 'COUNT') return numbers.length;
      if (name === 'SUM') return guard(numbers.reduce((s, x) => s + x, 0));
      if (name === 'AVG') return numbers.length ? guard(numbers.reduce((s, x) => s + x, 0) / numbers.length) : new Err('#DIV/0!');
      if (!numbers.length) return 0;
      return name === 'MIN' ? Math.min(...numbers) : Math.max(...numbers);
    }
    if (args.some((arg) => arg.t === 'range')) {
      return ['IF', 'ROUND', 'ABS'].includes(name) ? new Err('#VALUE!') : new Err('#NAME?');
    }
    if (name === 'IF') {
      if (args.length !== 3) return new Err('#VALUE!');
      const c = evaluate(args[0]);
      if (isErr(c)) return c;
      const n = toNumber(c);
      if (isErr(n)) return n;
      return evaluate(n !== 0 ? args[1] : args[2]);
    }
    if (name === 'ROUND') {
      if (args.length !== 2) return new Err('#VALUE!');
      const x = evaluate(args[0]);
      if (isErr(x)) return x;
      const d = evaluate(args[1]);
      if (isErr(d)) return d;
      const xn = toNumber(x);
      if (isErr(xn)) return xn;
      const dn = toNumber(d);
      if (isErr(dn)) return dn;
      if (!Number.isInteger(dn) || dn < 0 || dn > 6) return new Err('#VALUE!');
      const scale = 10 ** dn;
      return Math.sign(xn) * Math.round(Math.abs(xn) * scale) / scale;
    }
    if (name === 'ABS') {
      if (args.length !== 1) return new Err('#VALUE!');
      const x = evaluate(args[0]);
      if (isErr(x)) return x;
      const n = toNumber(x);
      return isErr(n) ? n : Math.abs(n);
    }
    return new Err('#NAME?');
  }
  function evaluate(node) {
    switch (node.t) {
      case 'num':
        return node.v;
      case 'str':
        return node.v;
      case 'ref':
        return lookup(node.id);
      case 'range':
        return new Err('#VALUE!');
      case 'neg': {
        const v = evaluate(node.e);
        if (isErr(v)) return v;
        const n = toNumber(v);
        return isErr(n) ? n : -n;
      }
      case 'call':
        return call(node);
      default: {
        const a = evaluate(node.l);
        if (isErr(a)) return a;
        const b = evaluate(node.r);
        if (isErr(b)) return b;
        if (['=', '<>', '<', '<=', '>', '>='].includes(node.op)) return compare(node.op, a, b);
        if (node.op === '&') return toText(a) + toText(b);
        const x = toNumber(a);
        if (isErr(x)) return x;
        const y = toNumber(b);
        if (isErr(y)) return y;
        if (node.op === '+') return guard(x + y);
        if (node.op === '-') return guard(x - y);
        if (node.op === '*') return guard(x * y);
        if (node.op === '/') return y === 0 ? new Err('#DIV/0!') : guard(x / y);
        return guard(x ** y);
      }
    }
  }

  const out = {};
  for (const id of ids) {
    if (poisoned.has(id)) {
      out[id] = '#CYCLE!';
      continue;
    }
    const v = valueOf(id);
    out[id] = isErr(v) ? v.code : typeof v === 'number' ? show(v) : v === null ? '' : v;
  }
  return out;
}
