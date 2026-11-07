import { SqlError } from './errors.mjs';
import { tokenize } from './lexer.mjs';

const COMPARE = new Set(['=', '<>', '!=', '<', '<=', '>', '>=']);
const AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max']);

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.at = 0;
  }

  peek(ahead = 0) {
    return this.tokens[Math.min(this.at + ahead, this.tokens.length - 1)];
  }

  next() {
    return this.tokens[Math.min(this.at++, this.tokens.length - 1)];
  }

  fail() {
    const token = this.peek();
    throw new SqlError('syntax', token.type === 'eof' ? 'unexpected end of input' : `unexpected ${token.text}`, token.pos);
  }

  isKw(text, ahead = 0) {
    const token = this.peek(ahead);
    return token.type === 'kw' && token.text === text;
  }

  isOp(text, ahead = 0) {
    const token = this.peek(ahead);
    return token.type === 'op' && token.text === text;
  }

  acceptKw(text) {
    if (!this.isKw(text)) return false;
    this.at += 1;
    return true;
  }

  acceptOp(text) {
    if (!this.isOp(text)) return false;
    this.at += 1;
    return true;
  }

  expectKw(text) {
    if (!this.acceptKw(text)) this.fail();
  }

  expectOp(text) {
    if (!this.acceptOp(text)) this.fail();
  }

  name() {
    if (this.peek().type !== 'name') this.fail();
    return this.next();
  }

  query() {
    this.expectKw('select');
    const items = [this.item()];
    while (this.acceptOp(',')) items.push(this.item());
    this.expectKw('from');
    const from = this.source();
    const joins = [];
    for (;;) {
      let kind = null;
      if (this.acceptKw('inner')) kind = 'inner';
      else if (this.acceptKw('left')) {
        kind = 'left';
        this.acceptKw('outer');
      }
      if (kind === null && !this.isKw('join')) break;
      this.expectKw('join');
      const source = this.source();
      this.expectKw('on');
      joins.push({ kind: kind ?? 'inner', ...source, on: this.expr() });
    }
    const out = { items, from, joins, where: null, groupBy: [], having: null, orderBy: [], limit: null, offset: null };
    if (this.acceptKw('where')) out.where = this.expr();
    if (this.acceptKw('group')) {
      this.expectKw('by');
      out.groupBy.push(this.colref());
      while (this.acceptOp(',')) out.groupBy.push(this.colref());
    }
    if (this.acceptKw('having')) out.having = this.expr();
    if (this.acceptKw('order')) {
      this.expectKw('by');
      do {
        const expr = this.expr();
        const desc = this.acceptKw('desc');
        if (!desc) this.acceptKw('asc');
        out.orderBy.push({ expr, desc });
      } while (this.acceptOp(','));
    }
    if (this.acceptKw('limit')) {
      out.limit = this.integer();
      if (this.acceptKw('offset')) out.offset = this.integer();
    }
    this.acceptOp(';');
    if (this.peek().type !== 'eof') this.fail();
    return out;
  }

  integer() {
    const token = this.peek();
    if (token.type !== 'num' || !token.isInt) this.fail();
    return this.next().value;
  }

  source() {
    const table = this.name().text;
    let alias = null;
    if (this.acceptKw('as')) alias = this.name().text;
    else if (this.peek().type === 'name') alias = this.next().text;
    return { table, alias };
  }

  item() {
    if (this.acceptOp('*')) return { star: true, table: null };
    if (this.peek().type === 'name' && this.isOp('.', 1) && this.isOp('*', 2)) {
      const table = this.next().text;
      this.at += 2;
      return { star: true, table };
    }
    const expr = this.expr();
    const alias = this.acceptKw('as') ? this.name().raw : null;
    return { star: false, expr, alias };
  }

  colref() {
    const first = this.name();
    if (this.acceptOp('.')) return { t: 'col', table: first.text, name: this.name().text };
    return { t: 'col', table: null, name: first.text };
  }

  expr() {
    return this.or();
  }

  or() {
    let left = this.and();
    while (this.acceptKw('or')) left = { t: 'bin', op: 'or', l: left, r: this.and() };
    return left;
  }

  and() {
    let left = this.not();
    while (this.acceptKw('and')) left = { t: 'bin', op: 'and', l: left, r: this.not() };
    return left;
  }

  not() {
    if (this.acceptKw('not')) return { t: 'un', op: 'not', e: this.not() };
    return this.comparison();
  }

  comparison() {
    const left = this.additive();
    const token = this.peek();
    if (token.type === 'op' && COMPARE.has(token.text)) {
      this.next();
      return { t: 'bin', op: token.text === '!=' ? '<>' : token.text, l: left, r: this.additive() };
    }
    if (this.acceptKw('is')) {
      const not = this.acceptKw('not');
      this.expectKw('null');
      return { t: 'isnull', e: left, not };
    }
    const not = this.acceptKw('not');
    if (this.acceptKw('in')) {
      this.expectOp('(');
      const list = [this.expr()];
      while (this.acceptOp(',')) list.push(this.expr());
      this.expectOp(')');
      return { t: 'in', e: left, list, not };
    }
    if (this.acceptKw('between')) {
      const lo = this.additive();
      this.expectKw('and');
      return { t: 'between', e: left, lo, hi: this.additive(), not };
    }
    if (this.acceptKw('like')) return { t: 'like', e: left, pattern: this.additive(), not };
    if (not) this.fail();
    return left;
  }

  additive() {
    let left = this.multiplicative();
    for (;;) {
      const token = this.peek();
      if (token.type === 'op' && (token.text === '+' || token.text === '-' || token.text === '||')) {
        this.next();
        left = { t: 'bin', op: token.text, l: left, r: this.multiplicative() };
      } else return left;
    }
  }

  multiplicative() {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token.type === 'op' && (token.text === '*' || token.text === '/' || token.text === '%')) {
        this.next();
        left = { t: 'bin', op: token.text, l: left, r: this.unary() };
      } else return left;
    }
  }

  unary() {
    if (this.acceptOp('-')) return { t: 'un', op: '-', e: this.unary() };
    return this.primary();
  }

  primary() {
    const token = this.peek();
    if (token.type === 'num' || token.type === 'str') {
      this.next();
      return { t: 'lit', v: token.value, int: token.isInt === true };
    }
    if (token.type === 'kw') {
      if (token.text === 'null' || token.text === 'true' || token.text === 'false') {
        this.next();
        return { t: 'lit', v: token.text === 'null' ? null : token.text === 'true', int: false };
      }
      if (token.text === 'case') return this.caseExpr();
      this.fail();
    }
    if (this.acceptOp('(')) {
      const inner = this.expr();
      this.expectOp(')');
      return inner;
    }
    if (token.type !== 'name') this.fail();
    if (this.isOp('(', 1)) return this.call();
    return this.colref();
  }

  caseExpr() {
    this.expectKw('case');
    const whens = [];
    do {
      this.expectKw('when');
      const c = this.expr();
      this.expectKw('then');
      whens.push({ c, v: this.expr() });
    } while (this.isKw('when'));
    const otherwise = this.acceptKw('else') ? this.expr() : null;
    this.expectKw('end');
    return { t: 'case', whens, otherwise };
  }

  call() {
    const name = this.next().text;
    this.expectOp('(');
    if (AGGREGATES.has(name)) {
      if (name === 'count' && this.acceptOp('*')) {
        this.expectOp(')');
        return { t: 'agg', name, arg: null, distinct: false };
      }
      const distinct = name === 'count' && this.acceptKw('distinct');
      const arg = this.expr();
      this.expectOp(')');
      return { t: 'agg', name, arg, distinct };
    }
    const args = [this.expr()];
    while (this.acceptOp(',')) args.push(this.expr());
    this.expectOp(')');
    return { t: 'fn', name, args };
  }
}

export function parse(sql) {
  return new Parser(tokenize(String(sql))).query();
}
