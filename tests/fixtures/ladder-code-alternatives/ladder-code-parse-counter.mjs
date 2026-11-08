// Count derivations of a pattern over a whole text, modulo 67108859.
// The pattern is parsed and checked first. Then every node of the pattern
// is turned into a matrix M[i][j] = count of derivations of text[i..j).
export function countParses(pattern, text) {
  const MOD = 67108859;
  const INVALID = { invalid: true };

  // ---------- parser ----------
  let pos = 0;
  const len = pattern.length;

  function fail() {
    throw INVALID;
  }

  function parseAlt() {
    const alts = [parseSeq()];
    while (pos < len && pattern[pos] === '|') {
      pos++;
      alts.push(parseSeq());
    }
    return alts.length === 1 ? alts[0] : { t: 'alt', alts };
  }

  function parseSeq() {
    const items = [];
    while (pos < len) {
      const ch = pattern[pos];
      if (ch === '|' || ch === ')') break;
      items.push(parseFactor());
    }
    return { t: 'seq', items };
  }

  function parseNumber() {
    const s = pos;
    while (pos < len && pattern[pos] >= '0' && pattern[pos] <= '9') pos++;
    if (pos === s) fail();
    const digits = pattern.slice(s, pos).replace(/^0+/, '');
    if (digits.length > 2) fail();
    const v = digits === '' ? 0 : Number(digits);
    if (v > 30) fail();
    return v;
  }

  function parseFactor() {
    let node = parseAtom();
    while (pos < len) {
      const ch = pattern[pos];
      if (ch === '*' || ch === '+' || ch === '?') {
        pos++;
        node = { t: 'q', k: ch, x: node };
      } else if (ch === '{') {
        pos++;
        const m = parseNumber();
        let n = m;
        let open = false;
        if (pos < len && pattern[pos] === ',') {
          pos++;
          if (pos < len && pattern[pos] === '}') open = true;
          else n = parseNumber();
        }
        if (pos >= len || pattern[pos] !== '}') fail();
        pos++;
        if (!open && m > n) fail();
        node = { t: 'q', k: 'rep', m, n: open ? -1 : n, x: node };
      } else break;
    }
    return node;
  }

  function parseAtom() {
    const ch = pattern[pos];
    if (ch === '(') {
      pos++;
      const inner = parseAlt();
      if (pos >= len || pattern[pos] !== ')') fail();
      pos++;
      return inner;
    }
    if (ch === '[') {
      pos++;
      return parseClass();
    }
    if (ch === '\\') {
      pos++;
      if (pos >= len) fail();
      return { t: 'lit', c: pattern[pos++] };
    }
    if (ch === '.') {
      pos++;
      return { t: 'any' };
    }
    if ('*+?{}])'.indexOf(ch) >= 0) fail();
    pos++;
    return { t: 'lit', c: ch };
  }

  function parseClass() {
    let neg = false;
    if (pos < len && pattern[pos] === '^') {
      neg = true;
      pos++;
    }
    const items = [];
    let first = true;
    // Read one class character; reports an unescaped dash.
    function readChar() {
      if (pos >= len) fail();
      const ch = pattern[pos];
      if (ch === '\\') {
        pos++;
        if (pos >= len) fail();
        return { c: pattern[pos++], dash: false };
      }
      pos++;
      return { c: ch, dash: ch === '-' };
    }
    for (;;) {
      if (pos >= len) fail();
      if (pattern[pos] === ']') break;
      const lo = readChar();
      if (lo.dash) {
        // A dash that starts an item is ordinary only if first or last.
        const last = pos < len && pattern[pos] === ']';
        if (!first && !last) fail();
      }
      first = false;
      if (pos < len && pattern[pos] === '-' && pos + 1 < len && pattern[pos + 1] !== ']') {
        pos++; // range sign
        const hi = readChar();
        if (lo.c.charCodeAt(0) > hi.c.charCodeAt(0)) fail();
        items.push([lo.c.charCodeAt(0), hi.c.charCodeAt(0)]);
      } else {
        items.push([lo.c.charCodeAt(0), lo.c.charCodeAt(0)]);
      }
    }
    pos++; // the closing ]
    if (items.length === 0) fail();
    return { t: 'cls', neg, items };
  }

  let ast;
  try {
    ast = parseAlt();
    if (pos < len) fail(); // stray ")"
  } catch (e) {
    if (e === INVALID) return -1;
    throw e;
  }

  // ---------- matrices ----------
  const L = text.length;
  const N = L + 1;
  const make = () => {
    const m = new Array(N);
    for (let i = 0; i < N; i++) m[i] = new Float64Array(N);
    return m;
  };
  const ident = () => {
    const m = make();
    for (let i = 0; i < N; i++) m[i][i] = 1;
    return m;
  };
  const addM = (A, B) => {
    const C = make();
    for (let i = 0; i < N; i++) {
      for (let j = i; j < N; j++) C[i][j] = (A[i][j] + B[i][j]) % MOD;
    }
    return C;
  };
  const concat = (A, B) => {
    const C = make();
    for (let i = 0; i < N; i++) {
      const Ai = A[i];
      for (let j = i; j < N; j++) {
        let s = 0;
        for (let m = i; m <= j; m++) {
          const a = Ai[m];
          if (a === 0) continue;
          const b = B[m][j];
          if (b === 0) continue;
          s += (a * b) % MOD;
        }
        C[i][j] = s % MOD;
      }
    }
    return C;
  };
  // S[i][j] = [i==j] + sum over m in (i, j] of X[i][m] * S[m][j]
  const star = (X) => {
    const S = make();
    for (let j = 0; j < N; j++) {
      for (let i = j; i >= 0; i--) {
        let s = i === j ? 1 : 0;
        const Xi = X[i];
        for (let m = i + 1; m <= j; m++) {
          const a = Xi[m];
          if (a === 0) continue;
          const b = S[m][j];
          if (b === 0) continue;
          s += (a * b) % MOD;
        }
        S[i][j] = s % MOD;
      }
    }
    return S;
  };

  function evalNode(node) {
    switch (node.t) {
      case 'lit': {
        const M = make();
        for (let i = 0; i < L; i++) if (text[i] === node.c) M[i][i + 1] = 1;
        return M;
      }
      case 'any': {
        const M = make();
        for (let i = 0; i < L; i++) M[i][i + 1] = 1;
        return M;
      }
      case 'cls': {
        const M = make();
        for (let i = 0; i < L; i++) {
          const code = text.charCodeAt(i);
          let inside = false;
          for (const it of node.items) {
            if (code >= it[0] && code <= it[1]) {
              inside = true;
              break;
            }
          }
          if (inside !== node.neg) M[i][i + 1] = 1;
        }
        return M;
      }
      case 'seq': {
        let cur = ident();
        for (const f of node.items) cur = concat(cur, evalNode(f));
        return cur;
      }
      case 'alt': {
        let cur = evalNode(node.alts[0]);
        for (let a = 1; a < node.alts.length; a++) cur = addM(cur, evalNode(node.alts[a]));
        return cur;
      }
      case 'q': {
        const X = evalNode(node.x);
        if (node.k === '*') return star(X);
        if (node.k === '+') return concat(X, star(X));
        if (node.k === '?') return addM(ident(), X);
        // counted repeat
        const { m, n } = node;
        let P = ident(); // X^0
        let sum = m === 0 ? ident() : make();
        const upto = n === -1 ? m : n;
        for (let k = 1; k <= upto; k++) {
          P = concat(P, X);
          if (k >= m) sum = addM(sum, P);
        }
        if (n === -1) {
          // X{m,} = X{m} followed by X*
          return m === 0 ? star(X) : concat(P, star(X));
        }
        return sum;
      }
      default:
        throw new Error('bad node');
    }
  }

  const R = evalNode(ast);
  return R[0][L] % MOD;
}
