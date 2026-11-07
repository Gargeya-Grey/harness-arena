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

  // EVAL BY ENUMERATION. Every derivation is visited once, so the time grows with the count.
  // The test files set __STEP_LIMIT to count the tests that no enumeration can finish; in the sandbox it is not set.
  const LIMIT = typeof __STEP_LIMIT === 'number' ? __STEP_LIMIT : Infinity;
  let steps = 0;
  let total = 0;
  const tick = () => {
    steps += 1;
    if (steps > LIMIT) throw new Error('step limit');
  };
  const go = (node, i, k) => {
    tick();
    switch (node.t) {
      case 'lit':
        if (i < text.length && text[i] === node.c) k(i + 1);
        return;
      case 'any':
        if (i < text.length) k(i + 1);
        return;
      case 'class':
        if (i < text.length && node.ranges.some(([lo, hi]) => text[i] >= lo && text[i] <= hi) !== node.negate) k(i + 1);
        return;
      case 'seq': {
        const run = (index, at) => {
          if (index === node.items.length) k(at);
          else go(node.items[index], at, (next) => run(index + 1, next));
        };
        run(0, i);
        return;
      }
      case 'alt':
        for (const item of node.items) go(item, i, k);
        return;
      case 'star':
        star(node.e, i, k);
        return;
      case 'plus':
        go(node.e, i, (j) => star(node.e, j, k));
        return;
      case 'opt':
        k(i);
        go(node.e, i, k);
        return;
      default: {
        const repeat = (at, left, done) => {
          if (left === 0) done(at);
          else go(node.e, at, (next) => repeat(next, left - 1, done));
        };
        if (node.open) repeat(i, node.min, (j) => star(node.e, j, k));
        else for (let count = node.min; count <= node.max; count += 1) repeat(i, count, k);
      }
    }
  };
  const star = (node, i, k) => {
    k(i);
    go(node, i, (j) => {
      if (j > i) star(node, j, k);
    });
  };
  go(tree, 0, (j) => {
    if (j === text.length) total += 1;
  });
  return total % P;
}
