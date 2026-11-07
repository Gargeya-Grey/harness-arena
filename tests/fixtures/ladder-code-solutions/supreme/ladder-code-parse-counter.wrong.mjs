function countParses(pattern, text) {
  const P = 67108859;
  const INVALID = { invalid: true };
  const bad = () => {
    throw INVALID;
  };
  const METAS = '|()[]{}*+?.\\';

  // PARSE
  let pos = 0;
  function parseAlt() {
    const items = [parseSeq()];
    while (pattern[pos] === '|') {
      pos += 1;
      items.push(parseSeq());
    }
    return { t: 'alt', items };
  }
  function parseSeq() {
    const items = [];
    while (pos < pattern.length && pattern[pos] !== '|' && pattern[pos] !== ')') items.push(parseFactor());
    return { t: 'seq', items };
  }
  function parseNumber() {
    const start = pos;
    while (pos < pattern.length && pattern[pos] >= '0' && pattern[pos] <= '9') pos += 1;
    if (pos === start) bad();
    const value = Number(pattern.slice(start, pos));
    if (value > 30) bad();
    return value;
  }
  function parseFactor() {
    let node = parseAtom();
    for (;;) {
      const c = pattern[pos];
      if (c === '*') {
        pos += 1;
        node = { t: 'star', e: node };
      } else if (c === '+') {
        pos += 1;
        node = { t: 'plus', e: node };
      } else if (c === '?') {
        pos += 1;
        node = { t: 'opt', e: node };
      } else if (c === '{') {
        pos += 1;
        const min = parseNumber();
        let max = min;
        let open = false;
        if (pattern[pos] === ',') {
          pos += 1;
          if (pattern[pos] === '}') open = true;
          else max = parseNumber();
        }
        if (pattern[pos] !== '}') bad();
        pos += 1;
        if (!open && max < min) bad();
        node = { t: 'rep', e: node, min, max, open };
      } else break;
    }
    return node;
  }
  function parseAtom() {
    const c = pattern[pos];
    if (c === undefined || c === '*' || c === '+' || c === '?' || c === '{' || c === '}' || c === ']') return bad();
    if (c === '(') {
      pos += 1;
      const inner = parseAlt();
      if (pattern[pos] !== ')') bad();
      pos += 1;
      return inner;
    }
    if (c === '[') return parseClass();
    if (c === '.') {
      pos += 1;
      return { t: 'any' };
    }
    if (c === '\\') {
      pos += 1;
      if (pos >= pattern.length) bad();
      pos += 1;
      return { t: 'lit', c: pattern[pos - 1] };
    }
    pos += 1;
    return { t: 'lit', c };
  }
  function parseClass() {
    pos += 1;
    let negate = false;
    if (pattern[pos] === '^') {
      negate = true;
      pos += 1;
    }
    const ranges = [];
    const readChar = () => {
      let c = pattern[pos];
      if (c === undefined) bad();
      if (c === '\\') {
        pos += 1;
        c = pattern[pos];
        if (c === undefined) bad();
      } else if (c === '-' && !(ranges.length === 0 || pattern[pos + 1] === ']')) bad();
      pos += 1;
      return c;
    };
    for (;;) {
      if (pos >= pattern.length) bad();
      if (pattern[pos] === ']') {
        if (!ranges.length) bad();
        pos += 1;
        break;
      }
      const lo = readChar();
      if (pattern[pos] === '-' && pos + 1 < pattern.length && pattern[pos + 1] !== ']') {
        pos += 1;
        const hi = readChar();
        if (hi < lo) bad();
        ranges.push([lo, hi]);
      } else ranges.push([lo, lo]);
    }
    return { t: 'class', negate, ranges };
  }

  let tree;
  try {
    tree = parseAlt();
    if (pos < pattern.length) bad();
  } catch (error) {
    if (error === INVALID) return -1;
    throw error;
  }

  // EVAL
  const n = text.length;
  const W = n + 1;
  const identity = () => {
    const M = new Float64Array(W * W);
    for (let i = 0; i <= n; i += 1) M[i * W + i] = 1;
    return M;
  };
  const concat = (A, B) => {
    const R = new Float64Array(W * W);
    for (let i = 0; i <= n; i += 1) {
      for (let p = i; p <= n; p += 1) {
        const a = A[i * W + p];
        if (a === 0) continue;
        for (let j = p; j <= n; j += 1) {
          const b = B[p * W + j];
          if (b !== 0) R[i * W + j] = (R[i * W + j] + a * b) % P;
        }
      }
    }
    return R;
  };
  const sum = (A, B) => {
    const R = new Float64Array(W * W);
    for (let k = 0; k < R.length; k += 1) R[k] = (A[k] + B[k]) % P;
    return R;
  };
  // Zero or more iterations, each one consuming at least one character.
  const star = (X) => {
    const S = new Float64Array(W * W);
    for (let i = n; i >= 0; i -= 1) {
      S[i * W + i] = 1;
      for (let j = i + 1; j <= n; j += 1) {
        let acc = 0;
        for (let p = i + 1; p <= j; p += 1) {
          const x = X[i * W + p];
          if (x !== 0) acc = (acc + x * S[p * W + j]) % P;
        }
        S[i * W + j] = acc;
      }
    }
    return S;
  };
  const single = (accepts) => {
    const M = new Float64Array(W * W);
    for (let i = 0; i < n; i += 1) if (accepts(text[i])) M[i * W + i + 1] = 1;
    return M;
  };
  function evaluate(node) {
    switch (node.t) {
      case 'lit':
        return single((c) => c === node.c);
      case 'any':
        return single(() => true);
      case 'class':
        return single((c) => node.ranges.some(([lo, hi]) => c >= lo && c <= hi) !== node.negate);
      case 'seq': {
        let acc = identity();
        for (const item of node.items) acc = concat(acc, evaluate(item));
        return acc;
      }
      case 'alt': {
        let acc = evaluate(node.items[0]);
        for (let k = 1; k < node.items.length; k += 1) acc = sum(acc, evaluate(node.items[k]));
        return acc;
      }
      case 'star':
        return star(evaluate(node.e));
      case 'plus': {
        const X = evaluate(node.e);
        return concat(X, star(X));
      }
      case 'opt':
        return sum(identity(), evaluate(node.e));
      default: {
        // Counted repetition: every iteration may match the empty string.
        const X = evaluate(node.e);
        for (let i = 0; i <= n; i += 1) X[i * W + i] = 0;
        let power = identity();
        let total = new Float64Array(W * W);
        const top = node.open ? node.min : node.max;
        for (let k = 0; k <= top; k += 1) {
          if (k > 0) power = concat(power, X);
          if (k >= node.min && !node.open) total = sum(total, power);
        }
        return node.open ? concat(power, star(X)) : total;
      }
    }
  }
  return evaluate(tree)[0 * W + n];
}
