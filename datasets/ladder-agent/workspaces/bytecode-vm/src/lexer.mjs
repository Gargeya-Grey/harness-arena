import { LangError } from './errors.mjs';

// Section 2 of SPEC.md. tokenize(source) -> tokens, the last one of type 'eof'.
// A token is { type, text, value, line, column }:
//   type is 'number', 'string', 'ident' or 'eof', or, for a keyword or an operator, the word or the symbol itself.
//   value is the number or the unescaped string; text is the source text.
const KEYWORDS = new Set(['let', 'fn', 'if', 'else', 'while', 'for', 'return', 'break', 'continue', 'true', 'false', 'nil', 'and', 'or']);
const ESCAPES = { n: '\n', t: '\t', '"': '"', '\\': '\\' };
const TWO = new Set(['!=', '==', '<=', '>=']);
const ONE = new Set('(){}[],;+-*/%!=<>');

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let column = 1;
  const step = () => {
    if (source[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    i += 1;
  };
  const fail = (message, atLine, atColumn) => {
    throw new LangError('syntax', message, atLine, atColumn);
  };

  while (i < source.length) {
    const c = source[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      step();
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') step();
      continue;
    }
    const start = { line, column, at: i };
    if (/[0-9]/.test(c)) {
      while (/[0-9]/.test(source[i] || '')) step();
      if (source[i] === '.' && /[0-9]/.test(source[i + 1] || '')) {
        step();
        while (/[0-9]/.test(source[i] || '')) step();
      }
      const text = source.slice(start.at, i);
      tokens.push({ type: 'number', text, value: Number(text), line: start.line, column: start.column });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      while (/[A-Za-z0-9_]/.test(source[i] || '')) step();
      const text = source.slice(start.at, i);
      tokens.push({ type: KEYWORDS.has(text) ? text : 'ident', text, value: text, line: start.line, column: start.column });
      continue;
    }
    if (c === '"') {
      step();
      let value = '';
      for (;;) {
        if (i >= source.length) fail('Unterminated string.', start.line, start.column);
        const d = source[i];
        if (d === '"') {
          step();
          break;
        }
        if (d === '\\') {
          const escapeLine = line;
          const escapeColumn = column;
          step();
          const e = source[i];
          if (e === undefined) fail('Unterminated string.', start.line, start.column);
          if (!(e in ESCAPES)) fail(`Invalid escape '\\${e}'.`, escapeLine, escapeColumn);
          value += ESCAPES[e];
          step();
          continue;
        }
        value += d;
        step();
      }
      tokens.push({ type: 'string', text: source.slice(start.at, i), value, line: start.line, column: start.column });
      continue;
    }
    const pair = source.slice(i, i + 2);
    if (TWO.has(pair)) {
      step();
      step();
      tokens.push({ type: pair, text: pair, value: pair, line: start.line, column: start.column });
      continue;
    }
    if (ONE.has(c)) {
      step();
      tokens.push({ type: c, text: c, value: c, line: start.line, column: start.column });
      continue;
    }
    fail(`Unexpected character '${c}'.`, line, column);
  }
  tokens.push({ type: 'eof', text: '', value: null, line, column });
  return tokens;
}
