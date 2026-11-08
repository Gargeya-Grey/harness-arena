import { SqlError } from './errors.mjs';

export const KEYWORDS = new Set(
  'select from where group by having order limit offset join inner left outer on as and or not is null true false in between like case when then else end asc desc distinct'.split(' '),
);

const TWO = new Set(['<=', '>=', '<>', '!=', '||']);
const ONE = new Set(['=', '<', '>', '+', '-', '*', '/', '%', '(', ')', ',', '.', ';']);

export function tokenize(sql) {
  const tokens = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i += 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
      const raw = sql.slice(i, j);
      const text = raw.toLowerCase();
      tokens.push({ type: KEYWORDS.has(text) ? 'kw' : 'name', text, raw, pos: i });
      i = j;
    } else if (c >= '0' && c <= '9') {
      let j = i;
      while (j < n && sql[j] >= '0' && sql[j] <= '9') j += 1;
      let isInt = true;
      if (sql[j] === '.' && sql[j + 1] >= '0' && sql[j + 1] <= '9') {
        isInt = false;
        j += 1;
        while (j < n && sql[j] >= '0' && sql[j] <= '9') j += 1;
      }
      tokens.push({ type: 'num', text: sql.slice(i, j), value: Number(sql.slice(i, j)), isInt, pos: i });
      i = j;
    } else if (c === "'") {
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= n) throw new SqlError('syntax', 'unterminated string', i);
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          break;
        }
        value += sql[j];
        j += 1;
      }
      tokens.push({ type: 'str', text: sql.slice(i, j + 1), value, pos: i });
      i = j + 1;
    } else if (TWO.has(sql.slice(i, i + 2))) {
      tokens.push({ type: 'op', text: sql.slice(i, i + 2), pos: i });
      i += 2;
    } else if (ONE.has(c)) {
      tokens.push({ type: 'op', text: c, pos: i });
      i += 1;
    } else {
      throw new SqlError('syntax', `unexpected character ${c}`, i);
    }
  }
  tokens.push({ type: 'eof', text: '', pos: n });
  return tokens;
}
