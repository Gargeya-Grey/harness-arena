function evalWithPositions(text) {
  const n = text.length;
  let i = 0;
  let tok = null;
  const fail = (pos) => {
    throw { pos };
  };
  const isLetter = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  const isDigit = (c) => c >= '0' && c <= '9';
  const lex = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i += 1;
    if (i >= n) {
      tok = { kind: 'end', pos: n + 1 };
      return;
    }
    const c = text[i];
    const pos = i + 1;
    if (isDigit(c)) {
      let j = i;
      while (j < n && isDigit(text[j])) j += 1;
      tok = { kind: 'int', value: BigInt(text.slice(i, j)), pos };
      i = j;
    } else if (isLetter(c)) {
      let j = i;
      while (j < n && isLetter(text[j])) j += 1;
      tok = { kind: 'name', value: text.slice(i, j), pos };
      i = j;
    } else if ('+-*/%^!(),'.includes(c)) {
      tok = { kind: 'op', value: c, pos };
      i += 1;
    } else fail(pos);
  };
  const isOp = (v) => tok.kind === 'op' && tok.value === v;

  const parseSum = () => {
    let left = parseProduct();
    while (isOp('+') || isOp('-')) {
      const op = tok.value;
      const pos = tok.pos;
      lex();
      left = { t: 'bin', op, pos, l: left, r: parseProduct() };
    }
    return left;
  };
  const parseProduct = () => {
    let left = parseUnary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tok.value;
      const pos = tok.pos;
      lex();
      left = { t: 'bin', op, pos, l: left, r: parseUnary() };
    }
    return left;
  };
  const parseUnary = () => {
    if (isOp('-')) {
      lex();
      return { t: 'neg', e: parseUnary() };
    }
    return parsePower();
  };
  const parsePower = () => {
    const base = parsePostfix();
    if (isOp('^')) {
      const pos = tok.pos;
      lex();
      return { t: 'bin', op: '^', pos, l: base, r: parseUnary() };
    }
    return base;
  };
  const parsePostfix = () => {
    let e = parseAtom();
    while (isOp('!')) {
      e = { t: 'fact', pos: tok.pos, e };
      lex();
    }
    return e;
  };
  const parseAtom = () => {
    if (tok.kind === 'int') {
      const e = { t: 'int', v: tok.value };
      lex();
      return e;
    }
    if (isOp('(')) {
      lex();
      const e = parseSum();
      if (!isOp(')')) fail(tok.pos);
      lex();
      return e;
    }
    if (tok.kind === 'name') {
      const name = tok.value;
      const pos = tok.pos;
      lex();
      if (!isOp('(')) fail(tok.pos);
      lex();
      const args = [];
      if (!isOp(')')) {
        args.push(parseSum());
        while (isOp(',')) {
          lex();
          args.push(parseSum());
        }
        if (!isOp(')')) fail(tok.pos);
      }
      lex();
      return { t: 'call', name, pos, args };
    }
    return fail(tok.pos);
  };

  const abs = (v) => (v < 0n ? -v : v);
  const ev = (e) => {
    if (e.t === 'int') return e.v;
    if (e.t === 'neg') return -ev(e.e);
    if (e.t === 'fact') {
      const v = ev(e.e);
      if (v < 0n || v > 20n) fail(e.pos);
      let r = 1n;
      for (let k = 2n; k <= v; k += 1n) r *= k;
      return r;
    }
    if (e.t === 'bin') {
      const a = ev(e.l);
      const b = ev(e.r);
      if (e.op === '+') return a + b;
      if (e.op === '-') return a - b;
      if (e.op === '*') return a * b;
      if (e.op === '^') {
        if (b < 0n || b > 200n) fail(e.pos);
        return a ** b;
      }
      if (b === 0n) fail(e.pos);
      return e.op === '/' ? a / b : a % b;
    }
    const vals = e.args.map(ev);
    if (e.name === 'min' || e.name === 'max') {
      if (vals.length < 1) fail(e.pos);
      let best = vals[0];
      for (const v of vals) if (e.name === 'min' ? v < best : v > best) best = v;
      return best;
    }
    if (e.name === 'abs' && vals.length === 1) return abs(vals[0]);
    if (e.name === 'gcd' && vals.length === 2) {
      let x = abs(vals[0]);
      let y = abs(vals[1]);
      while (y !== 0n) [x, y] = [y, x % y];
      return x;
    }
    return fail(e.pos);
  };

  try {
    lex();
    const tree = parseSum();
    if (tok.kind !== 'end') fail(tok.pos);
    return ev(tree).toString();
  } catch (error) {
    if (error && typeof error.pos === 'number') return `ERR@${error.pos}`;
    throw error;
  }
}
