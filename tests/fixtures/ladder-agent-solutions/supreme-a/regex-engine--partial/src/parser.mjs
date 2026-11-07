import { RegexSyntaxError } from './errors.mjs';
import { classEscape } from './units.mjs';

const COUNT = /^\{(\d+)(?:(,)(\d*))?\}/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
const SIMPLE_ESCAPES = { n: 10, r: 13, t: 9, f: 12, v: 11 };
const MAX_COUNT = 1000;

export function parse(pattern) {
  let i = 0;
  let groupCount = 0;
  const names = {};

  const fail = (code, detail) => {
    throw new RegexSyntaxError(code, detail);
  };

  function counted() {
    const m = COUNT.exec(pattern.slice(i, i + 24));
    if (!m) return null;
    const min = Number(m[1]);
    const max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : min;
    return { length: m[0].length, min, max };
  }

  function isRepeatAhead() {
    const c = pattern[i];
    return c === '*' || c === '+' || c === '?' || (c === '{' && counted() !== null);
  }

  function readRepeat() {
    const c = pattern[i];
    let min;
    let max;
    if (c === '*') [min, max] = [0, Infinity];
    else if (c === '+') [min, max] = [1, Infinity];
    else if (c === '?') [min, max] = [0, 1];
    else {
      const m = counted();
      if (m.min > MAX_COUNT || (m.max !== Infinity && m.max > MAX_COUNT) || m.max < m.min) fail('bad-count', pattern.slice(i, i + m.length));
      [min, max] = [m.min, m.max];
      i += m.length - 1;
    }
    i += 1;
    let lazy = false;
    if (pattern[i] === '?') {
      lazy = true;
      i += 1;
    }
    return { min, max, lazy };
  }

  function hex(count) {
    const digits = pattern.slice(i + 2, i + 2 + count);
    if (digits.length !== count || !/^[0-9A-Fa-f]+$/.test(digits)) fail('bad-escape', pattern.slice(i, i + 2 + count));
    i += 2 + count;
    return parseInt(digits, 16);
  }

  /** After the backslash at i: a class escape, an assertion, or one character code. */
  function escape(inClass) {
    const c = pattern[i + 1];
    if (c === undefined) fail('bad-escape', 'trailing backslash');
    if (/[dDwWsS]/.test(c)) {
      i += 2;
      return { set: classEscape(c) };
    }
    if (c === 'b' || c === 'B') {
      if (inClass) fail('bad-escape', `\\${c}`);
      i += 2;
      return { assert: c === 'b' ? 'wb' : 'nwb' };
    }
    if (c in SIMPLE_ESCAPES) {
      i += 2;
      return { code: SIMPLE_ESCAPES[c] };
    }
    if (c === '0') {
      i += 2;
      return { code: 0 };
    }
    if (c === 'x') return { code: hex(2) };
    if (c === 'u') return { code: hex(4) };
    if (/[A-Za-z0-9]/.test(c)) fail('bad-escape', `\\${c}`);
    i += 2;
    return { code: c.charCodeAt(0) };
  }

  function classAtom() {
    if (pattern[i] === '\\') {
      const e = escape(true);
      return e.set ? { set: e.set } : { code: e.code };
    }
    const code = pattern.charCodeAt(i);
    i += 1;
    return { code };
  }

  function parseClass() {
    i += 1;
    let neg = false;
    if (pattern[i] === '^') {
      neg = true;
      i += 1;
    }
    const ranges = [];
    for (;;) {
      if (i >= pattern.length) fail('unterminated-class');
      if (pattern[i] === ']') break;
      const a = classAtom();
      if (pattern[i] === '-' && i + 1 < pattern.length && pattern[i + 1] !== ']') {
        i += 1;
        const b = classAtom();
        if (a.set || b.set || a.code > b.code) fail('bad-range');
        ranges.push([a.code, b.code]);
      } else if (a.set) ranges.push(...a.set);
      else ranges.push([a.code, a.code]);
    }
    i += 1;
    return { t: 'set', ranges, neg };
  }

  function parseGroup() {
    i += 1;
    let index = null;
    if (pattern[i] === '?') {
      if (pattern[i + 1] === ':') i += 2;
      else if (pattern[i + 1] === '<' && pattern[i + 2] !== '=' && pattern[i + 2] !== '!') {
        const m = NAME.exec(pattern.slice(i + 2));
        if (!m || pattern[i + 2 + m[0].length] !== '>') fail('bad-name');
        groupCount += 1;
        index = groupCount;
        Object.defineProperty(names, m[0], { value: index, enumerable: true, writable: true, configurable: true });
        i += 3 + m[0].length;
      } else fail('unsupported-group');
    } else {
      groupCount += 1;
      index = groupCount;
    }
    const node = parseAlt();
    if (pattern[i] !== ')') fail('unterminated-group');
    i += 1;
    return { t: 'group', index, node };
  }

  function parseAtom() {
    const c = pattern[i];
    if (c === '(') return parseGroup();
    if (c === '[') return parseClass();
    if (c === '*' || c === '+' || c === '?') fail('nothing-to-repeat');
    if (c === '{' && counted() !== null) fail('nothing-to-repeat');
    if (c === '.') {
      i += 1;
      return { t: 'any' };
    }
    if (c === '^' || c === '$') {
      i += 1;
      return { t: 'assert', k: c === '^' ? 'bol' : 'eol' };
    }
    if (c === '\\') {
      const e = escape(false);
      if (e.assert) return { t: 'assert', k: e.assert };
      if (e.set) return { t: 'set', ranges: e.set, neg: false };
      return { t: 'char', c: e.code };
    }
    i += 1;
    return { t: 'char', c: c.charCodeAt(0) };
  }

  function parseCat() {
    const items = [];
    while (i < pattern.length && pattern[i] !== '|' && pattern[i] !== ')') {
      let node = parseAtom();
      if (isRepeatAhead()) {
        if (node.t === 'assert') fail('nothing-to-repeat');
        const { min, max, lazy } = readRepeat();
        node = { t: 'rep', node, min, max, lazy };
        if (isRepeatAhead()) fail('nothing-to-repeat');
      }
      items.push(node);
    }
    if (items.length === 0) return { t: 'empty' };
    return items.length === 1 ? items[0] : { t: 'cat', items };
  }

  function parseAlt() {
    const alts = [parseCat()];
    while (pattern[i] === '|') {
      i += 1;
      alts.push(parseCat());
    }
    return alts.length === 1 ? alts[0] : { t: 'alt', alts };
  }

  const tree = parseAlt();
  if (i < pattern.length) fail('unmatched-paren');
  return { tree, groupCount, names };
}
