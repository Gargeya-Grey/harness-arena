function evalExpr(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < s.length && s[j] >= '0' && s[j] <= '9') j += 1;
      tokens.push({ t: 'num', v: BigInt(s.slice(i, j)) });
      i = j;
      continue;
    }
    if ('+-*/%^()'.includes(c)) {
      tokens.push({ t: c });
      i += 1;
      continue;
    }
    return 'ERR';
  }
  let pos = 0;
  const peek = () => (tokens[pos] ? tokens[pos].t : null);
  const fail = () => {
    throw new Error('bad');
  };
  const floorDiv = (a, b) => {
    const q = a / b;
    return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
  };
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos].t;
      pos += 1;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = tokens[pos].t;
      pos += 1;
      const r = power();
      if (op === '*') {
        v *= r;
      } else {
        if (r === 0n) fail();
        v = op === '/' ? floorDiv(v, r) : v - floorDiv(v, r) * r;
      }
    }
    return v;
  }
  function unary() {
    if (peek() === '-') {
      pos += 1;
      return -unary();
    }
    return atom();
  }
  function power() {
    let v = unary();
    while (peek() === '^') {
      pos += 1;
      const e = unary();
      if (e < 0n || e > 1000n) fail();
      v **= e;
    }
    return v;
  }
  function atom() {
    const tk = tokens[pos];
    if (!tk) fail();
    if (tk.t === 'num') {
      pos += 1;
      return tk.v;
    }
    if (tk.t === '(') {
      pos += 1;
      const v = expr();
      if (peek() !== ')') fail();
      pos += 1;
      return v;
    }
    return fail();
  }
  try {
    const v = expr();
    if (pos !== tokens.length) return 'ERR';
    return v.toString();
  } catch (error) {
    return 'ERR';
  }
}
