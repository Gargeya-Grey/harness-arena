function runTabula(blocks, query) {
  const RESERVED = new Set([
    'from', 'join', 'as', 'on', 'left', 'where', 'derive', 'group', 'sort', 'asc', 'desc', 'take', 'skip', 'pick', 'distinct',
    'and', 'or', 'not', 'is', 'null', 'in', 'between', 'like', 'yes', 'no',
  ]);
  const SAFE = Number.MAX_SAFE_INTEGER;
  const SCALARS = { upper: 1, lower: 1, len: 1, abs: 1, str: 1, substr: 3, round: 2, iif: 3, nullif: 2, coalesce: 0 };
  const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max'];

  class Fail extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const fail = (code) => {
    throw new Fail(code);
  };

  // ---------------------------------------------------------------- values
  // A value is null or { k: 'int' | 'dec' | 'text' | 'bool', v }.

  // A dec keeps its exact value as a BigInt count of ten-thousandths in `u`.
  const int = (v) => {
    if (Math.abs(v) > SAFE) fail('overflow');
    return { k: 'int', v: v === 0 ? 0 : v };
  };
  const mkDec = (u) => {
    if (u > 9007199254740991n || u < -9007199254740991n) fail('overflow');
    return { k: 'dec', u, v: Number(u) / 10000 };
  };
  const text = (v) => ({ k: 'text', v });
  const bool = (v) => ({ k: 'bool', v });
  const isNumber = (value) => value !== null && (value.k === 'int' || value.k === 'dec');
  const toUnits = (value) => (value.k === 'int' ? BigInt(value.v) * 10000n : value.u);

  function divRound(num, den) {
    const negative = (num < 0n) !== (den < 0n);
    const n = num < 0n ? -num : num;
    const d = den < 0n ? -den : den;
    const q = (2n * n + d) / (2n * d);
    return negative ? -q : q;
  }

  function parseDec(source) {
    const negative = source.startsWith('-');
    const body = negative ? source.slice(1) : source;
    const [whole, fraction = ''] = body.split('.');
    let units = BigInt(whole) * 10000n + BigInt((fraction + '0000').slice(0, 4));
    if (fraction.length > 4 && fraction[4] >= '5') units += 1n;
    return mkDec(negative ? -units : units);
  }

  const keyOf = (value) => (value === null ? 'null' : `${value.k}:${value.k === 'dec' ? value.u.toString() : value.v}`);

  function compareValues(a, b) {
    if (isNumber(a) && isNumber(b)) {
      const x = toUnits(a);
      const y = toUnits(b);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    if (a.k !== b.k) fail('type');
    if (a.k === 'text') {
      const left = Array.from(a.v);
      const right = Array.from(b.v);
      for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
        const x = left[i].codePointAt(0);
        const y = right[i].codePointAt(0);
        if (x !== y) return x < y ? -1 : 1;
      }
      return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
    }
    if (a.k === 'bool') return a.v === b.v ? 0 : a.v ? 1 : -1;
    return 0;
  }

  function show(value) {
    if (value === null) return null;
    if (value.k === 'bool') return value.v ? 'yes' : 'no';
    return String(value.v);
  }

  const plain = (value) => (value === null ? null : value.v);

  // ---------------------------------------------------------------- tables

  function splitCells(line) {
    const cells = [];
    let i = 0;
    for (;;) {
      while (line[i] === ' ' || line[i] === '\t') i += 1;
      let cell;
      if (line[i] === '"') {
        let value = '';
        i += 1;
        for (;;) {
          if (i >= line.length) fail('data');
          const ch = line[i];
          if (ch === '\\') {
            const next = line[i + 1];
            if (next !== '"' && next !== '\\') fail('data');
            value += next;
            i += 2;
          } else if (ch === '"') {
            i += 1;
            break;
          } else {
            value += ch;
            i += 1;
          }
        }
        cell = { quoted: true, value };
      } else {
        let end = line.indexOf('|', i);
        if (end < 0) end = line.length;
        cell = { quoted: false, value: line.slice(i, end).trim() };
        i = end;
      }
      cells.push(cell);
      while (line[i] === ' ' || line[i] === '\t') i += 1;
      if (i >= line.length) return cells;
      if (line[i] !== '|') fail('data');
      i += 1;
    }
  }

  function parseTable(block) {
    const lines = String(block).split(/\r\n|\r|\n/).filter((line) => line.trim() !== '' && !line.startsWith('#'));
    if (lines.length < 2 || !/^@[a-z][a-z0-9_]*$/.test(lines[0].trim())) fail('data');
    const name = lines[0].trim().slice(1);
    const columns = splitCells(lines[1]).map((cell) => {
      const match = /^([a-z_][a-z0-9_]*):(int|text|dec|bool)(\?)?$/.exec(cell.value);
      if (cell.quoted || !match || RESERVED.has(match[1])) fail('data');
      return { name: match[1], type: match[2], nullable: Boolean(match[3]) };
    });
    if (new Set(columns.map((c) => c.name)).size !== columns.length) fail('data');
    const rows = lines.slice(2).map((line) => {
      const cells = splitCells(line);
      if (cells.length !== columns.length) fail('data');
      return cells.map((cell, index) => {
        const column = columns[index];
        if (!cell.quoted && cell.value === '~') {
          if (!column.nullable) fail('data');
          return null;
        }
        if (column.type === 'text') {
          if (!cell.quoted) fail('data');
          return text(cell.value);
        }
        if (cell.quoted) fail('data');
        if (column.type === 'int') {
          if (!/^-?[0-9]+$/.test(cell.value)) fail('data');
          return int(Number(cell.value));
        }
        if (column.type === 'dec') {
          if (!/^-?[0-9]+(\.[0-9]+)?$/.test(cell.value)) fail('data');
          return parseDec(cell.value);
        }
        if (cell.value !== 'yes' && cell.value !== 'no') fail('data');
        return bool(cell.value === 'yes');
      });
    });
    return { name, columns, rows };
  }

  function findTable(name) {
    for (const block of blocks) {
      const first = String(block).split(/\r\n|\r|\n/).filter((line) => line.trim() !== '' && !line.startsWith('#'))[0];
      if (first !== undefined && first.trim() === `@${name}`) return parseTable(block);
    }
    return fail('unknown-table');
  }

  // ---------------------------------------------------------------- tokens

  function tokenize(source) {
    const tokens = [];
    let i = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i += 1;
      } else if (/[0-9]/.test(ch)) {
        let j = i;
        while (/[0-9]/.test(source[j] || '')) j += 1;
        let isDec = false;
        if (source[j] === '.' && /[0-9]/.test(source[j + 1] || '')) {
          isDec = true;
          j += 1;
          while (/[0-9]/.test(source[j] || '')) j += 1;
        }
        tokens.push({ type: 'num', text: source.slice(i, j), dec: isDec });
        i = j;
      } else if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (/[A-Za-z0-9_]/.test(source[j] || '')) j += 1;
        const word = source.slice(i, j);
        const lower = word.toLowerCase();
        tokens.push(RESERVED.has(lower) ? { type: 'kw', text: lower } : { type: 'id', text: word });
        i = j;
      } else if (ch === '"') {
        let value = '';
        i += 1;
        for (;;) {
          if (i >= source.length) fail('syntax');
          if (source[i] === '\\') {
            if (source[i + 1] !== '"' && source[i + 1] !== '\\') fail('syntax');
            value += source[i + 1];
            i += 2;
          } else if (source[i] === '"') {
            i += 1;
            break;
          } else {
            value += source[i];
            i += 1;
          }
        }
        tokens.push({ type: 'str', text: value });
      } else {
        const two = source.slice(i, i + 2);
        if (['<>', '<=', '>=', '||'].includes(two)) {
          tokens.push({ type: 'sym', text: two });
          i += 2;
        } else if ('|,():.=<>+-*/%'.includes(ch)) {
          tokens.push({ type: 'sym', text: ch });
          i += 1;
        } else {
          fail('syntax');
        }
      }
    }
    return tokens;
  }

  // ---------------------------------------------------------------- parser

  function parseQuery(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const atSym = (s) => peek() && peek().type === 'sym' && peek().text === s;
    const atKw = (k) => peek() && peek().type === 'kw' && peek().text === k;
    const takeSym = (s) => {
      if (!atSym(s)) fail('syntax');
      pos += 1;
    };
    const takeKw = (k) => {
      if (!atKw(k)) fail('syntax');
      pos += 1;
    };
    const takeId = () => {
      if (!peek() || peek().type !== 'id') fail('syntax');
      pos += 1;
      return tokens[pos - 1].text;
    };

    function parseRef() {
      const first = takeId();
      if (atSym('.')) {
        pos += 1;
        return { op: 'ref', alias: first, name: takeId() };
      }
      return { op: 'ref', alias: null, name: first };
    }

    function parseOr() {
      let left = parseAnd();
      while (atKw('or')) {
        pos += 1;
        left = { op: 'or', a: left, b: parseAnd() };
      }
      return left;
    }

    function parseAnd() {
      let left = parseNot();
      while (atKw('and')) {
        pos += 1;
        left = { op: 'and', a: left, b: parseNot() };
      }
      return left;
    }

    function parseNot() {
      if (atKw('not')) {
        pos += 1;
        return { op: 'not', a: parseNot() };
      }
      return parseComparison();
    }

    function parseComparison() {
      const left = parseConcat();
      const t = peek();
      if (t && t.type === 'sym' && ['=', '<>', '<', '<=', '>', '>='].includes(t.text)) {
        pos += 1;
        return { op: 'cmp', cmp: t.text, a: left, b: parseConcat() };
      }
      if (atKw('is')) {
        pos += 1;
        let negate = false;
        if (atKw('not')) {
          pos += 1;
          negate = true;
        }
        takeKw('null');
        return { op: 'isnull', a: left, negate };
      }
      let negate = false;
      if (atKw('not') && tokens[pos + 1] && tokens[pos + 1].type === 'kw' && ['in', 'between', 'like'].includes(tokens[pos + 1].text)) {
        pos += 1;
        negate = true;
      }
      if (atKw('in')) {
        pos += 1;
        takeSym('(');
        const items = [parseOr()];
        while (atSym(',')) {
          pos += 1;
          items.push(parseOr());
        }
        takeSym(')');
        return { op: 'in', a: left, items, negate };
      }
      if (atKw('between')) {
        pos += 1;
        const low = parseConcat();
        takeKw('and');
        return { op: 'between', a: left, low, high: parseConcat(), negate };
      }
      if (atKw('like')) {
        pos += 1;
        return { op: 'like', a: left, pattern: parseConcat(), negate };
      }
      return left;
    }

    function parseConcat() {
      let left = parseSum();
      while (atSym('||')) {
        pos += 1;
        left = { op: 'concat', a: left, b: parseSum() };
      }
      return left;
    }

    function parseSum() {
      let left = parseProduct();
      while (atSym('+') || atSym('-')) {
        const sym = peek().text;
        pos += 1;
        left = { op: 'arith', sym, a: left, b: parseProduct() };
      }
      return left;
    }

    function parseProduct() {
      let left = parseUnary();
      while (atSym('*') || atSym('/') || atSym('%')) {
        const sym = peek().text;
        pos += 1;
        left = { op: 'arith', sym, a: left, b: parseUnary() };
      }
      return left;
    }

    function parseUnary() {
      if (atSym('-')) {
        pos += 1;
        return { op: 'neg', a: parseUnary() };
      }
      return parsePrimary();
    }

    function parsePrimary() {
      const t = peek();
      if (!t) fail('syntax');
      if (t.type === 'num') {
        pos += 1;
        return { op: 'lit', value: t.dec ? parseDec(t.text) : int(Number(t.text)) };
      }
      if (t.type === 'str') {
        pos += 1;
        return { op: 'lit', value: text(t.text) };
      }
      if (t.type === 'kw' && (t.text === 'yes' || t.text === 'no')) {
        pos += 1;
        return { op: 'lit', value: bool(t.text === 'yes') };
      }
      if (t.type === 'kw' && t.text === 'null') {
        pos += 1;
        return { op: 'lit', value: null };
      }
      if (t.type === 'sym' && t.text === '(') {
        pos += 1;
        const inner = parseOr();
        takeSym(')');
        return inner;
      }
      if (t.type === 'id') {
        if (tokens[pos + 1] && tokens[pos + 1].type === 'sym' && tokens[pos + 1].text === '(') {
          const name = t.text.toLowerCase();
          pos += 2;
          const args = [];
          let distinct = false;
          if (atKw('distinct')) {
            pos += 1;
            distinct = true;
          }
          if (!atSym(')')) {
            args.push(parseOr());
            while (atSym(',')) {
              pos += 1;
              args.push(parseOr());
            }
          }
          takeSym(')');
          if (name in SCALARS) {
            if (distinct) fail('syntax');
            if (SCALARS[name] === 0 ? args.length === 0 : args.length !== SCALARS[name]) fail('syntax');
          }
          return { op: 'call', name, args, distinct };
        }
        return parseRef();
      }
      return fail('syntax');
    }

    function parseNames(keyParser) {
      const list = [keyParser()];
      while (atSym(',')) {
        pos += 1;
        list.push(keyParser());
      }
      return list;
    }

    function parseCount() {
      if (!peek() || peek().type !== 'num' || peek().dec) fail('syntax');
      pos += 1;
      return Number(tokens[pos - 1].text);
    }

    function parseStage(first) {
      if (first) {
        takeKw('from');
        const name = takeId();
        let alias = name;
        if (atKw('as')) {
          pos += 1;
          alias = takeId();
        }
        return { kind: 'from', name, alias };
      }
      const t = peek();
      if (!t || t.type !== 'kw') fail('syntax');
      pos += 1;
      if (t.text === 'join') {
        const name = takeId();
        let alias = name;
        if (atKw('as')) {
          pos += 1;
          alias = takeId();
        }
        takeKw('on');
        const on = parseOr();
        let left = false;
        if (atKw('left')) {
          pos += 1;
          left = true;
        }
        return { kind: 'join', name, alias, on, left };
      }
      if (t.text === 'where') return { kind: 'where', expr: parseOr() };
      if (t.text === 'derive') {
        return {
          kind: 'derive',
          items: parseNames(() => {
            const name = takeId();
            takeSym('=');
            return { name, expr: parseOr() };
          }),
        };
      }
      if (t.text === 'group') {
        const keys = [];
        if (!atSym(':')) keys.push(...parseNames(parseRef));
        takeSym(':');
        const aggs = parseNames(() => {
          const name = takeId();
          takeSym('=');
          const call = parsePrimary();
          if (call.op !== 'call' || !AGGREGATES.includes(call.name)) fail('syntax');
          if (call.name === 'count' ? call.args.length > 1 : call.args.length !== 1) fail('syntax');
          if (call.distinct && (call.name !== 'count' || call.args.length !== 1)) fail('syntax');
          return { name, call };
        });
        return { kind: 'group', keys, aggs };
      }
      if (t.text === 'sort') {
        return {
          kind: 'sort',
          keys: parseNames(() => {
            const ref = parseRef();
            let desc = false;
            if (atKw('desc')) {
              pos += 1;
              desc = true;
            } else if (atKw('asc')) {
              pos += 1;
            }
            return { ref, desc };
          }),
        };
      }
      if (t.text === 'take') return { kind: 'take', n: parseCount() };
      if (t.text === 'skip') return { kind: 'skip', n: parseCount() };
      if (t.text === 'pick') {
        return {
          kind: 'pick',
          items: parseNames(() => {
            const ref = parseRef();
            let name = ref.name;
            if (atKw('as')) {
              pos += 1;
              name = takeId();
            }
            return { ref, name };
          }),
        };
      }
      if (t.text === 'distinct') return { kind: 'distinct' };
      return fail('syntax');
    }

    const stages = [parseStage(true)];
    while (atSym('|')) {
      pos += 1;
      stages.push(parseStage(false));
    }
    if (pos < tokens.length) fail('syntax');
    return stages;
  }

  // ---------------------------------------------------------------- evaluation of expressions

  // frame: { columns: [{ name, alias }], row }
  function resolve(columns, ref) {
    const hits = [];
    columns.forEach((column, index) => {
      if (column.name !== ref.name) return;
      if (ref.alias !== null && column.alias !== ref.alias) return;
      hits.push(index);
    });
    if (hits.length === 0) fail('unknown-column');
    if (hits.length > 1) fail('ambiguous-column');
    return hits[0];
  }

  function checkRefs(columns, expr) {
    if (expr.op === 'ref') {
      resolve(columns, expr);
      return;
    }
    if (expr.op === 'call' && !(expr.name in SCALARS)) fail('unknown-function');
    for (const key of ['a', 'b', 'low', 'high', 'pattern']) if (expr[key]) checkRefs(columns, expr[key]);
    for (const key of ['items', 'args']) if (expr[key]) expr[key].forEach((one) => checkRefs(columns, one));
  }

  const needBool = (value) => {
    if (value !== null && value.k !== 'bool') fail('type');
    return value;
  };

  function like(subject, pattern) {
    const s = Array.from(subject);
    const p = Array.from(pattern);
    const memo = new Map();
    const walk = (i, j) => {
      const key = i * 100000 + j;
      if (memo.has(key)) return memo.get(key);
      let result;
      if (j === p.length) result = i === s.length;
      else if (p[j] === '%') result = walk(i, j + 1) || (i < s.length && walk(i + 1, j));
      else result = i < s.length && (p[j] === '_' || p[j] === s[i]) && walk(i + 1, j + 1);
      memo.set(key, result);
      return result;
    };
    return walk(0, 0);
  }

  function arith(sym, a, b) {
    if (a === null || b === null) return null;
    if (!isNumber(a) || !isNumber(b)) fail('type');
    const bothInt = a.k === 'int' && b.k === 'int';
    if (sym === '%') {
      if (!bothInt) fail('type');
      if (b.v === 0) fail('div-zero');
      return int(a.v % b.v);
    }
    if (sym === '/') {
      if (toUnits(b) === 0n) fail('div-zero');
      return bothInt ? int(Number(BigInt(a.v) / BigInt(b.v))) : mkDec(divRound(toUnits(a) * 10000n, toUnits(b)));
    }
    if (bothInt) return int(sym === '+' ? a.v + b.v : sym === '-' ? a.v - b.v : a.v * b.v);
    const x = toUnits(a);
    const y = toUnits(b);
    if (sym === '+') return mkDec(x + y);
    if (sym === '-') return mkDec(x - y);
    return mkDec(divRound(x * y, 10000n));
  }

  function evaluate(expr, frame) {
    switch (expr.op) {
      case 'lit':
        return expr.value;
      case 'ref':
        return frame.row[resolve(frame.columns, expr)];
      case 'neg': {
        const value = evaluate(expr.a, frame);
        if (value === null) return null;
        if (!isNumber(value)) fail('type');
        return value.k === 'int' ? int(-value.v) : mkDec(-value.u);
      }
      case 'arith':
        return arith(expr.sym, evaluate(expr.a, frame), evaluate(expr.b, frame));
      case 'concat': {
        const a = evaluate(expr.a, frame);
        const b = evaluate(expr.b, frame);
        if (a === null || b === null) return null;
        if (a.k !== 'text' || b.k !== 'text') fail('type');
        return text(a.v + b.v);
      }
      case 'cmp': {
        const a = evaluate(expr.a, frame);
        const b = evaluate(expr.b, frame);
        if (a === null || b === null) return null;
        const order = compareValues(a, b);
        const ok = { '=': order === 0, '<>': order !== 0, '<': order < 0, '<=': order <= 0, '>': order > 0, '>=': order >= 0 }[expr.cmp];
        return bool(ok);
      }
      case 'isnull': {
        const value = evaluate(expr.a, frame);
        return bool((value === null) !== expr.negate);
      }
      case 'not': {
        const value = needBool(evaluate(expr.a, frame));
        return value === null ? null : bool(!value.v);
      }
      case 'and': {
        const a = needBool(evaluate(expr.a, frame));
        if (a !== null && !a.v) return bool(false);
        const b = needBool(evaluate(expr.b, frame));
        if (b !== null && !b.v) return bool(false);
        return a === null || b === null ? null : bool(true);
      }
      case 'or': {
        const a = needBool(evaluate(expr.a, frame));
        if (a !== null && a.v) return bool(true);
        const b = needBool(evaluate(expr.b, frame));
        if (b !== null && b.v) return bool(true);
        return a === null || b === null ? null : bool(false);
      }
      case 'in': {
        const subject = evaluate(expr.a, frame);
        if (subject === null) return null;
        let sawNull = false;
        let found = false;
        for (const item of expr.items) {
          const value = evaluate(item, frame);
          if (value === null) sawNull = true;
          else if (compareValues(subject, value) === 0) found = true;
        }
        const result = found ? true : sawNull ? null : false;
        return result === null ? null : bool(expr.negate ? !result : result);
      }
      case 'between': {
        const subject = evaluate(expr.a, frame);
        const low = evaluate(expr.low, frame);
        const high = evaluate(expr.high, frame);
        const lowOk = subject === null || low === null ? null : compareValues(subject, low) >= 0;
        const highOk = subject === null || high === null ? null : compareValues(subject, high) <= 0;
        let result;
        if (lowOk === false || highOk === false) result = false;
        else if (lowOk === null || highOk === null) result = null;
        else result = true;
        return result === null ? null : bool(expr.negate ? !result : result);
      }
      case 'like': {
        const subject = evaluate(expr.a, frame);
        const pattern = evaluate(expr.pattern, frame);
        if (subject === null || pattern === null) return null;
        if (subject.k !== 'text' || pattern.k !== 'text') fail('type');
        const result = like(subject.v, pattern.v);
        return bool(expr.negate ? !result : result);
      }
      case 'call':
        return callFunction(expr, frame);
      default:
        return fail('syntax');
    }
  }

  function callFunction(expr, frame) {
    const args = expr.args;
    const name = expr.name;
    const count = (n) => {
      if (args.length !== n) fail('syntax');
    };
    if (expr.distinct) fail('syntax');
    if (name === 'coalesce') {
      if (args.length === 0) fail('syntax');
      for (const arg of args) {
        const value = evaluate(arg, frame);
        if (value !== null) return value;
      }
      return null;
    }
    if (name === 'iif') {
      count(3);
      const condition = needBool(evaluate(args[0], frame));
      return condition !== null && condition.v ? evaluate(args[1], frame) : evaluate(args[2], frame);
    }
    if (name === 'nullif') {
      count(2);
      const a = evaluate(args[0], frame);
      const b = evaluate(args[1], frame);
      if (a === null || b === null) return a;
      return compareValues(a, b) === 0 ? null : a;
    }
    const values = args.map((arg) => evaluate(arg, frame));
    if (name === 'upper' || name === 'lower' || name === 'len' || name === 'abs' || name === 'str') {
      count(1);
      const value = values[0];
      if (value === null) return null;
      if (name === 'str') return text(show(value));
      if (name === 'abs') {
        if (!isNumber(value)) fail('type');
        return value.k === 'int' ? int(Math.abs(value.v)) : mkDec(value.u < 0n ? -value.u : value.u);
      }
      if (value.k !== 'text') fail('type');
      if (name === 'upper') return text(value.v.toUpperCase());
      if (name === 'lower') return text(value.v.toLowerCase());
      return int(Array.from(value.v).length);
    }
    if (name === 'substr') {
      count(3);
      if (values.some((value) => value === null)) return null;
      if (values[0].k !== 'text' || values[1].k !== 'int' || values[2].k !== 'int') fail('type');
      const chars = Array.from(values[0].v);
      const start = Math.max(1, values[1].v);
      const length = values[2].v - (start - values[1].v);
      return text(length > 0 ? chars.slice(start - 1, start - 1 + length).join('') : '');
    }
    if (name === 'round') {
      count(2);
      if (values.some((value) => value === null)) return null;
      if (!isNumber(values[0]) || values[1].k !== 'int') fail('type');
      if (values[0].k === 'int') return values[0];
      const places = Math.min(4, Math.max(0, values[1].v));
      const step = 10n ** BigInt(4 - places);
      return mkDec(divRound(values[0].u, step) * step);
    }
    return fail('unknown-function');
  }

  // ---------------------------------------------------------------- stages

  const seenNames = (columns) => {
    const names = columns.map((c) => c.name);
    return new Set(names).size !== names.length;
  };

  function shownColumns(columns) {
    const counts = new Map();
    for (const column of columns) counts.set(column.name, (counts.get(column.name) || 0) + 1);
    return columns.map((column) => (counts.get(column.name) > 1 && column.alias ? `${column.alias}.${column.name}` : column.name));
  }

  function loadSource(stage) {
    const table = findTable(stage.name);
    return { columns: table.columns.map((c) => ({ name: c.name, alias: stage.alias })), rows: table.rows };
  }

  function runStages(stages) {
    let state = loadSource(stages[0]);
    for (const stage of stages.slice(1)) {
      if (stage.kind === 'join') {
        const right = loadSource(stage);
        const columns = [...state.columns, ...right.columns];
        const seenAliases = new Set(state.columns.map((c) => c.alias));
        if (seenAliases.has(stage.alias)) fail('dup-column');
        checkRefs(columns, stage.on);
        const rows = [];
        for (const leftRow of state.rows) {
          let matched = false;
          for (const rightRow of right.rows) {
            const row = [...leftRow, ...rightRow];
            const verdict = needBool(evaluate(stage.on, { columns, row }));
            if (verdict !== null && verdict.v) {
              rows.push(row);
              matched = true;
            }
          }
          if (!matched && stage.left) rows.push([...leftRow, ...right.columns.map(() => null)]);
        }
        state = { columns, rows };
      } else if (stage.kind === 'where') {
        checkRefs(state.columns, stage.expr);
        const rows = state.rows.filter((row) => {
          const verdict = needBool(evaluate(stage.expr, { columns: state.columns, row }));
          return verdict !== null && verdict.v;
        });
        state = { columns: state.columns, rows };
      } else if (stage.kind === 'derive') {
        let columns = state.columns;
        let rows = state.rows;
        for (const item of stage.items) {
          checkRefs(columns, item.expr);
          if (columns.some((column) => column.name === item.name)) fail('dup-column');
          const next = [...columns, { name: item.name, alias: null }];
          rows = rows.map((row) => [...row, evaluate(item.expr, { columns, row })]);
          columns = next;
        }
        state = { columns, rows };
      } else if (stage.kind === 'group') {
        state = runGroup(state, stage);
      } else if (stage.kind === 'sort') {
        const indexes = stage.keys.map((key) => resolve(state.columns, key.ref));
        const order = state.rows.map((row, position) => ({ row, position }));
        order.sort((x, y) => {
          for (let k = 0; k < indexes.length; k += 1) {
            const a = x.row[indexes[k]];
            const b = y.row[indexes[k]];
            let c;
            if (a === null || b === null) c = a === b ? 0 : a === null ? -1 : 1;
            else c = compareValues(a, b);
            if (c !== 0) return stage.keys[k].desc ? -c : c;
          }
          return x.position - y.position;
        });
        state = { columns: state.columns, rows: order.map((one) => one.row) };
      } else if (stage.kind === 'take') {
        state = { columns: state.columns, rows: state.rows.slice(0, stage.n) };
      } else if (stage.kind === 'skip') {
        state = { columns: state.columns, rows: state.rows.slice(stage.n) };
      } else if (stage.kind === 'pick') {
        const indexes = stage.items.map((item) => resolve(state.columns, item.ref));
        const columns = stage.items.map((item, k) => ({ name: item.name, alias: item.name === stage.items[k].ref.name ? state.columns[indexes[k]].alias : null }));
        if (seenNames(columns)) fail('dup-column');
        state = { columns, rows: state.rows.map((row) => indexes.map((index) => row[index])) };
      } else if (stage.kind === 'distinct') {
        const seen = new Set();
        const rows = [];
        for (const row of state.rows) {
          const key = row.map(keyOf).join('\u0001');
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }
        state = { columns: state.columns, rows };
      }
    }
    return state;
  }

  function runGroup(state, stage) {
    const keyIndexes = stage.keys.map((key) => resolve(state.columns, key));
    for (const agg of stage.aggs) for (const arg of agg.call.args) checkRefs(state.columns, arg);
    const columns = [
      ...keyIndexes.map((index) => ({ name: state.columns[index].name, alias: state.columns[index].alias })),
      ...stage.aggs.map((agg) => ({ name: agg.name, alias: null })),
    ];
    if (seenNames(columns)) fail('dup-column');
    const groups = new Map();
    for (const row of state.rows) {
      const key = keyIndexes.map((index) => keyOf(row[index])).join('\u0001');
      if (!groups.has(key)) groups.set(key, { keys: keyIndexes.map((index) => row[index]), rows: [] });
      groups.get(key).rows.push(row);
    }
    if (stage.keys.length === 0 && groups.size === 0) groups.set('', { keys: [], rows: [] });
    const rows = [];
    for (const group of groups.values()) {
      rows.push([...group.keys, ...stage.aggs.map((agg) => aggregate(agg.call, group.rows, state.columns))]);
    }
    return { columns, rows };
  }

  function aggregate(call, rows, columns) {
    const name = call.name;
    if (name === 'count' && call.args.length === 0) {
      if (call.distinct) fail('syntax');
      return int(rows.length);
    }
    if (call.args.length !== 1) fail('syntax');
    if (call.distinct && name !== 'count') fail('syntax');
    let values = rows.map((row) => evaluate(call.args[0], { columns, row })).filter((value) => value !== null);
    if (call.distinct) {
      const seen = new Set();
      values = values.filter((value) => {
        const key = keyOf(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (name === 'count') return int(values.length);
    if (values.length === 0) return null;
    if (name === 'min' || name === 'max') {
      let best = values[0];
      for (const value of values.slice(1)) {
        const order = compareValues(value, best);
        if (name === 'min' ? order < 0 : order > 0) best = value;
      }
      return best;
    }
    if (!values.every(isNumber)) fail('type');
    const allInt = values.every((value) => value.k === 'int');
    if (allInt) {
      let total = 0;
      for (const value of values) {
        total += value.v;
        if (Math.abs(total) > SAFE) fail('overflow');
      }
      if (name === 'sum') return int(total);
      return mkDec(divRound(BigInt(total) * 10000n, BigInt(values.length)));
    }
    let units = 0n;
    for (const value of values) units += toUnits(value);
    if (name === 'sum') return mkDec(units);
    return mkDec(divRound(units, BigInt(values.length)));
  }

  // ---------------------------------------------------------------- the entry point

  try {
    const stages = parseQuery(tokenize(String(query)));
    const result = runStages(stages);
    return {
      columns: shownColumns(result.columns),
      rows: result.rows.map((row) => row.map(plain)),
    };
  } catch (error) {
    if (error instanceof Fail) return { error: error.code };
    throw error;
  }
}
