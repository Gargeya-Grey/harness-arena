import { InferError } from './errors.mjs';

const LEVEL = { '||': 1, '&&': 2, '=': 3, '<>': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '::': 4, '^': 5, '+': 6, '-': 6, '*': 7, '/': 7 };
const RIGHT = new Set([1, 2, 4, 5]);
const desc = (token) => (token.kind === 'eof' ? 'end of input' : `'${token.text}'`);

export function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const isKw = (text) => peek().kind === 'kw' && peek().text === text;
  const fail = (token, message) => {
    throw new InferError(message, token.line, token.col);
  };
  const unexpected = (token) => fail(token, `unexpected ${desc(token)}`);
  const expect = (text) => {
    if (!isKw(text)) fail(peek(), `expected '${text}' but found ${desc(peek())}`);
    return take();
  };
  const ident = () => {
    if (peek().kind !== 'ident') fail(peek(), `expected identifier but found ${desc(peek())}`);
    return take();
  };
  const at = (token, node) => ({ ...node, line: token.line, col: token.col });
  const infixText = (token) => {
    if (token.kind === 'op' || (token.kind === 'kw' && (token.text === '=' || token.text === '::'))) return LEVEL[token.text] ? token.text : null;
    return null;
  };
  const startsAtom = (token) =>
    token.kind === 'int' || token.kind === 'string' || token.kind === 'ident' || (token.kind === 'kw' && ['true', 'false', '(', '['].includes(token.text));

  function expr() {
    const t = peek();
    if (t.kind === 'kw') {
      if (t.text === 'let') {
        take();
        const rec = isKw('rec');
        if (rec) take();
        const nameTok = ident();
        const params = [];
        while (peek().kind === 'ident') params.push(take());
        expect('=');
        let value = expr();
        if (params.length) value = at(params[0], { k: 'fun', params, body: value });
        expect('in');
        const body = expr();
        return at(t, { k: 'let', rec, name: nameTok.text, nameLine: nameTok.line, nameCol: nameTok.col, value, body });
      }
      if (t.text === 'fun') {
        take();
        const params = [ident()];
        while (peek().kind === 'ident') params.push(take());
        expect('->');
        return at(t, { k: 'fun', params, body: expr() });
      }
      if (t.text === 'if') {
        take();
        const cond = expr();
        expect('then');
        const yes = expr();
        expect('else');
        const no = expr();
        return at(t, { k: 'if', cond, yes, no });
      }
      if (t.text === 'match') {
        take();
        const scrutinee = expr();
        expect('with');
        if (isKw('|')) take();
        const arms = [];
        for (;;) {
          const pattern = pat();
          expect('->');
          arms.push({ pattern, body: expr() });
          if (!isKw('|')) break;
          take();
        }
        return at(t, { k: 'match', scrutinee, arms });
      }
    }
    return binary(1);
  }

  function operand() {
    const t = peek();
    if (t.kind === 'kw' && ['let', 'fun', 'if', 'match'].includes(t.text)) return expr();
    return application();
  }

  function binary(min) {
    let left = operand();
    for (;;) {
      const op = infixText(peek());
      const level = op ? LEVEL[op] : 0;
      if (!level || level < min) return left;
      take();
      const right = binary(RIGHT.has(level) ? level : level + 1);
      left = { k: 'bin', op, left, right, line: left.line, col: left.col };
    }
  }

  function application() {
    let fn = atom();
    while (startsAtom(peek())) {
      const arg = atom();
      fn = { k: 'app', fn, arg, line: fn.line, col: fn.col };
    }
    return fn;
  }

  function atom() {
    const t = take();
    if (t.kind === 'int') return at(t, { k: 'int' });
    if (t.kind === 'string') return at(t, { k: 'string' });
    if (t.kind === 'ident') return at(t, { k: 'var', name: t.text });
    if (t.kind === 'kw') {
      if (t.text === 'true' || t.text === 'false') return at(t, { k: 'bool' });
      if (t.text === '(') {
        if (isKw(')')) {
          take();
          return at(t, { k: 'unit' });
        }
        const first = expr();
        if (isKw(',')) {
          const items = [first];
          while (isKw(',')) {
            take();
            items.push(expr());
          }
          expect(')');
          return at(t, { k: 'tuple', items });
        }
        expect(')');
        return at(t, { ...first });
      }
      if (t.text === '[') {
        if (isKw(']')) {
          take();
          return at(t, { k: 'list', items: [] });
        }
        const items = [expr()];
        while (isKw(';')) {
          take();
          items.push(expr());
        }
        expect(']');
        return at(t, { k: 'list', items });
      }
    }
    return unexpected(t);
  }

  function pat() {
    const head = apat();
    if (isKw('::')) {
      take();
      const tail = pat();
      return { k: 'pcons', head, tail, line: head.line, col: head.col };
    }
    return head;
  }

  function apat() {
    const t = take();
    if (t.kind === 'int') return at(t, { k: 'pint' });
    if (t.kind === 'string') return at(t, { k: 'pstring' });
    if (t.kind === 'ident') return t.text === '_' ? at(t, { k: 'pwild' }) : at(t, { k: 'pvar', name: t.text });
    if (t.kind === 'kw') {
      if (t.text === 'true' || t.text === 'false') return at(t, { k: 'pbool' });
      if (t.text === '(') {
        if (isKw(')')) {
          take();
          return at(t, { k: 'punit' });
        }
        const first = pat();
        if (isKw(',')) {
          const items = [first];
          while (isKw(',')) {
            take();
            items.push(pat());
          }
          expect(')');
          return at(t, { k: 'ptuple', items });
        }
        expect(')');
        return at(t, { ...first });
      }
      if (t.text === '[') {
        if (isKw(']')) {
          take();
          return at(t, { k: 'pnil' });
        }
        const items = [pat()];
        while (isKw(';')) {
          take();
          items.push(pat());
        }
        expect(']');
        return at(t, { k: 'plist', items });
      }
    }
    return unexpected(t);
  }

  const result = expr();
  if (peek().kind !== 'eof') unexpected(peek());
  return result;
}
