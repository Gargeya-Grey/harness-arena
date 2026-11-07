function runLumen(source) {
  const LIMIT = 10n ** 60n;
  const KEYWORDS = new Set(['let', 'rec', 'in', 'if', 'then', 'else', 'fn', 'true', 'false']);
  const fail = (code) => {
    throw { lumen: code };
  };

  // Tokens.
  const tokens = [];
  const text = String(source);
  const TWO = new Set(['==', '!=', '<=', '>=', '&&', '||', '=>']);
  const ONE = new Set(['+', '-', '*', '/', '%', '^', '<', '>', '!', '(', ')', ',', '=']);
  function tokenize() {
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        i += 1;
      } else if (c === '#') {
        while (i < text.length && text[i] !== '\n') i += 1;
      } else if (c >= '0' && c <= '9') {
        let j = i;
        while (j < text.length && text[j] >= '0' && text[j] <= '9') j += 1;
        tokens.push({ type: 'num', value: BigInt(text.slice(i, j)) });
        i = j;
      } else if ((c >= 'a' && c <= 'z') || c === '_') {
        let j = i;
        while (j < text.length && ((text[j] >= 'a' && text[j] <= 'z') || (text[j] >= '0' && text[j] <= '9') || text[j] === '_')) j += 1;
        const word = text.slice(i, j);
        tokens.push(KEYWORDS.has(word) ? { type: 'kw', value: word } : { type: 'id', value: word });
        i = j;
      } else if (TWO.has(text.slice(i, i + 2))) {
        tokens.push({ type: 'op', value: text.slice(i, i + 2) });
        i += 2;
      } else if (ONE.has(c)) {
        tokens.push({ type: 'op', value: c });
        i += 1;
      } else {
        fail('syntax');
      }
    }
    tokens.push({ type: 'eof', value: '' });
  }

  // Parser.
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (value) => peek().type === 'op' && peek().value === value;
  const isKw = (value) => peek().type === 'kw' && peek().value === value;
  const expectOp = (value) => {
    if (!isOp(value)) fail('syntax');
    pos += 1;
  };
  const expectKw = (value) => {
    if (!isKw(value)) fail('syntax');
    pos += 1;
  };
  const expectId = () => {
    if (peek().type !== 'id') fail('syntax');
    pos += 1;
    return tokens[pos - 1].value;
  };

  function parseFn() {
    expectKw('fn');
    const params = [];
    if (!isOp('=>')) {
      params.push(expectId());
      while (isOp(',')) {
        pos += 1;
        params.push(expectId());
      }
    }
    if (new Set(params).size !== params.length) fail('syntax');
    expectOp('=>');
    return { t: 'fn', params, body: parseExpr() };
  }
  function parseExpr() {
    if (isKw('let')) {
      pos += 1;
      let rec = false;
      if (isKw('rec')) {
        rec = true;
        pos += 1;
      }
      const name = expectId();
      expectOp('=');
      if (rec && !isKw('fn')) fail('syntax');
      const value = rec ? parseFn() : parseExpr();
      expectKw('in');
      return { t: 'let', name, rec, value, body: parseExpr() };
    }
    if (isKw('if')) {
      pos += 1;
      const cond = parseExpr();
      expectKw('then');
      const yes = parseExpr();
      expectKw('else');
      return { t: 'if', cond, yes, no: parseExpr() };
    }
    if (isKw('fn')) return parseFn();
    return parseOr();
  }
  function parseOr() {
    let left = parseAnd();
    while (isOp('||')) {
      pos += 1;
      left = { t: 'or', l: left, r: parseAnd() };
    }
    return left;
  }
  function parseAnd() {
    let left = parseCompare();
    while (isOp('&&')) {
      pos += 1;
      left = { t: 'and', l: left, r: parseCompare() };
    }
    return left;
  }
  const COMPARE = new Set(['==', '!=', '<', '<=', '>', '>=']);
  const isCompare = () => peek().type === 'op' && COMPARE.has(peek().value);
  function parseCompare() {
    const left = parseAdd();
    if (!isCompare()) return left;
    const op = peek().value;
    pos += 1;
    const node = { t: 'bin', op, l: left, r: parseAdd() };
    if (isCompare()) fail('syntax');
    return node;
  }
  function parseAdd() {
    let left = parseMul();
    while (isOp('+') || isOp('-')) {
      const op = peek().value;
      pos += 1;
      left = { t: 'bin', op, l: left, r: parseMul() };
    }
    return left;
  }
  function parseMul() {
    let left = parseUnary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = peek().value;
      pos += 1;
      left = { t: 'bin', op, l: left, r: parseUnary() };
    }
    return left;
  }
  function parseUnary() {
    if (isOp('-')) {
      pos += 1;
      return { t: 'neg', e: parseUnary() };
    }
    if (isOp('!')) {
      pos += 1;
      return { t: 'not', e: parseUnary() };
    }
    return parsePower();
  }
  function parsePower() {
    const base = parsePostfix();
    if (isOp('^')) {
      pos += 1;
      return { t: 'bin', op: '^', l: base, r: parseUnary() };
    }
    return base;
  }
  function parsePostfix() {
    let e = parseAtom();
    while (isOp('(')) {
      pos += 1;
      const args = [];
      if (!isOp(')')) {
        args.push(parseExpr());
        while (isOp(',')) {
          pos += 1;
          args.push(parseExpr());
        }
      }
      expectOp(')');
      e = { t: 'call', f: e, args };
    }
    return e;
  }
  function parseAtom() {
    const token = peek();
    if (token.type === 'num') {
      pos += 1;
      return { t: 'num', value: token.value };
    }
    if (token.type === 'kw' && (token.value === 'true' || token.value === 'false')) {
      pos += 1;
      return { t: 'bool', value: token.value === 'true' };
    }
    if (token.type === 'id') {
      pos += 1;
      return { t: 'var', name: token.value };
    }
    if (isOp('(')) {
      pos += 1;
      const e = parseExpr();
      expectOp(')');
      return e;
    }
    return fail('syntax');
  }

  // Evaluation.
  const checked = (value) => {
    if (value >= LIMIT || value <= -LIMIT) fail('overflow');
    return value;
  };
  const lookup = (env, name) => {
    for (let e = env; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name);
    return fail('unbound');
  };
  function power(a, b) {
    if (b < 0n) fail('neg-exp');
    if (b === 0n) return 1n;
    if (a === 0n || a === 1n) return a;
    if (a === -1n) return b % 2n === 0n ? 1n : -1n;
    if (b > 200n) fail('overflow');
    return checked(a ** b);
  }
  function ev(n, env, depth) {
    switch (n.t) {
      case 'num':
        return checked(n.value);
      case 'bool':
        return n.value;
      case 'var':
        return lookup(env, n.name);
      case 'fn':
        return { params: n.params, body: n.body, env };
      case 'let': {
        if (n.rec) {
          const inner = { vars: new Map(), parent: env };
          const closure = { params: n.value.params, body: n.value.body, env: inner };
          inner.vars.set(n.name, closure);
          return ev(n.body, inner, depth);
        }
        const value = ev(n.value, env, depth);
        return ev(n.body, { vars: new Map([[n.name, value]]), parent: env }, depth);
      }
      case 'if': {
        const cond = ev(n.cond, env, depth);
        if (typeof cond !== 'boolean') fail('type');
        return ev(cond ? n.yes : n.no, env, depth);
      }
      case 'and': {
        const l = ev(n.l, env, depth);
        if (typeof l !== 'boolean') fail('type');
        const r = ev(n.r, env, depth);
        if (!l) return false;
        if (typeof r !== 'boolean') fail('type');
        return r;
      }
      case 'or': {
        const l = ev(n.l, env, depth);
        if (typeof l !== 'boolean') fail('type');
        const r = ev(n.r, env, depth);
        if (l) return true;
        if (typeof r !== 'boolean') fail('type');
        return r;
      }
      case 'neg': {
        const v = ev(n.e, env, depth);
        if (typeof v !== 'bigint') fail('type');
        return -v;
      }
      case 'not': {
        const v = ev(n.e, env, depth);
        if (typeof v !== 'boolean') fail('type');
        return !v;
      }
      case 'bin': {
        const a = ev(n.l, env, depth);
        const b = ev(n.r, env, depth);
        if (n.op === '==' || n.op === '!=') {
          if (typeof a !== typeof b || (typeof a !== 'bigint' && typeof a !== 'boolean')) fail('type');
          return n.op === '==' ? a === b : a !== b;
        }
        if (typeof a !== 'bigint' || typeof b !== 'bigint') fail('type');
        switch (n.op) {
          case '+':
            return checked(a + b);
          case '-':
            return checked(a - b);
          case '*':
            return checked(a * b);
          case '/':
            if (b === 0n) fail('div-zero');
            return a / b;
          case '%':
            if (b === 0n) fail('div-zero');
            return a % b;
          case '^':
            return power(a, b);
          case '<':
            return a < b;
          case '<=':
            return a <= b;
          case '>':
            return a > b;
          default:
            return a >= b;
        }
      }
      case 'call': {
        const f = ev(n.f, env, depth);
        const args = n.args.map((arg) => ev(arg, env, depth));
        if (typeof f !== 'object') fail('type');
        if (f.params.length !== args.length) fail('arity');
        if (depth + 1 > 200) fail('depth');
        const local = { vars: new Map(f.params.map((name, i) => [name, args[i]])), parent: f.env };
        return ev(f.body, local, depth + 1);
      }
      default:
        return fail('syntax');
    }
  }

  try {
    tokenize();
    const program = parseExpr();
    if (peek().type !== 'eof') fail('syntax');
    const value = ev(program, null, 0);
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return '<fn>';
  } catch (error) {
    if (error && typeof error === 'object' && 'lumen' in error) return `error: ${error.lumen}`;
    throw error;
  }
}
