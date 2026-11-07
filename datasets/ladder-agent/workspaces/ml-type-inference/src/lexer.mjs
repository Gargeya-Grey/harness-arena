// Turns source text into tokens. Complete; SPEC.md section 2 describes it.
// A token is { kind, text, line, col }. kind is one of
//   'int' | 'string' | 'ident' | 'kw' | 'op' | 'eof'
// 'kw' covers keywords and the punctuation ( ) [ ] , ; | -> = ::  (text says which).
// 'op' covers the infix operators + - * / ^ <> < <= > >= && ||  ('=' and '::' are 'kw').
import { InferError } from './errors.mjs';

const KEYWORDS = new Set(['let', 'rec', 'in', 'fun', 'if', 'then', 'else', 'match', 'with', 'true', 'false']);
const TWO = ['->', '::', '<>', '<=', '>=', '&&', '||'];
const ONE = '()[],;|=+-*/^<>';

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const advance = (n = 1) => {
    for (let k = 0; k < n; k += 1) {
      if (source[i] === '\n') {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
      i += 1;
    }
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      advance();
      continue;
    }
    const at = { line, col };
    if (ch === '(' && source[i + 1] === '*') {
      const end = source.indexOf('*)', i + 2);
      if (end < 0) throw new InferError('unterminated comment', at.line, at.col);
      advance(end + 2 - i);
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (source[j] >= '0' && source[j] <= '9') j += 1;
      tokens.push({ kind: 'int', text: source.slice(i, j), ...at });
      advance(j - i);
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"' && source[j] !== '\n') j += 1;
      if (source[j] !== '"') throw new InferError('unterminated string', at.line, at.col);
      tokens.push({ kind: 'string', text: source.slice(i, j + 1), ...at });
      advance(j + 1 - i);
      continue;
    }
    if (/[a-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_']/.test(source[j])) j += 1;
      const text = source.slice(i, j);
      tokens.push({ kind: KEYWORDS.has(text) ? 'kw' : 'ident', text, ...at });
      advance(j - i);
      continue;
    }
    const two = source.slice(i, i + 2);
    if (TWO.includes(two)) {
      const kind = two === '->' || two === '::' ? 'kw' : 'op';
      tokens.push({ kind, text: two, ...at });
      advance(2);
      continue;
    }
    if (ONE.includes(ch)) {
      const kind = '()[],;|='.includes(ch) ? 'kw' : 'op';
      tokens.push({ kind, text: ch, ...at });
      advance();
      continue;
    }
    throw new InferError(`unexpected character '${ch}'`, at.line, at.col);
  }
  tokens.push({ kind: 'eof', text: '', line, col });
  return tokens;
}
