import { LangError } from './errors.mjs';

export function parse(tokens) {
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const check = (type) => tokens[at].type === type;
  const accept = (type) => (check(type) ? next() : null);
  const fail = (message, token = peek()) => {
    throw new LangError('syntax', message, token.line, token.column);
  };
  const expect = (type, message) => accept(type) || fail(message);

  function program() {
    const body = [];
    while (!check('eof')) body.push(declaration());
    return { t: 'program', body };
  }

  function declaration() {
    if (check('fn') && tokens[at + 1].type === 'ident') return fnDeclaration();
    if (check('let')) return letDeclaration();
    return statement();
  }

  function params() {
    const list = [];
    if (!check(')')) {
      do list.push(expect('ident', 'Expect parameter name.'));
      while (accept(','));
    }
    expect(')', "Expect ')' after parameters.");
    return list;
  }

  function fnBody() {
    expect('{', "Expect '{' before function body.");
    return blockBody();
  }

  function fnDeclaration() {
    next();
    const name = next();
    expect('(', "Expect '(' after function name.");
    const list = params();
    return { t: 'fn', name: name.text, params: list, body: fnBody(), tok: name };
  }

  function letDeclaration() {
    next();
    const name = expect('ident', 'Expect variable name.');
    const init = accept('=') ? expression() : null;
    expect(';', "Expect ';' after variable declaration.");
    return { t: 'let', name: name.text, init, tok: name };
  }

  function blockBody() {
    const body = [];
    while (!check('}') && !check('eof')) body.push(declaration());
    expect('}', "Expect '}' after block.");
    return body;
  }

  function statement() {
    const tok = peek();
    switch (tok.type) {
      case '{':
        next();
        return { t: 'block', body: blockBody() };
      case 'if': {
        next();
        expect('(', "Expect '(' after 'if'.");
        const cond = expression();
        expect(')', "Expect ')' after condition.");
        const then = statement();
        return { t: 'if', cond, then, otherwise: accept('else') ? statement() : null };
      }
      case 'while': {
        next();
        expect('(', "Expect '(' after 'while'.");
        const cond = expression();
        expect(')', "Expect ')' after condition.");
        return { t: 'while', cond, body: statement(), tok };
      }
      case 'for': {
        next();
        expect('(', "Expect '(' after 'for'.");
        let init = null;
        if (check('let')) init = letDeclaration();
        else if (!accept(';')) init = expressionStatement();
        const cond = check(';') ? null : expression();
        expect(';', "Expect ';' after loop condition.");
        const step = check(')') ? null : expression();
        expect(')', "Expect ')' after for clauses.");
        return { t: 'for', init, cond, step, body: statement(), tok };
      }
      case 'return': {
        next();
        const value = check(';') ? null : expression();
        expect(';', "Expect ';' after return value.");
        return { t: 'return', value, tok };
      }
      case 'break':
      case 'continue':
        next();
        expect(';', `Expect ';' after '${tok.type}'.`);
        return { t: tok.type, tok };
      default:
        return expressionStatement();
    }
  }

  function expressionStatement() {
    const expr = expression();
    expect(';', "Expect ';' after expression.");
    return { t: 'expr', expr };
  }

  function expression() {
    const left = binary(0);
    if (check('=')) {
      const eq = next();
      if (left.t !== 'var' && left.t !== 'index') fail('Invalid assignment target.', eq);
      return { t: 'assign', target: left, value: expression(), tok: eq };
    }
    return left;
  }

  const LEVELS = [['or'], ['and'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

  function binary(level) {
    if (level === LEVELS.length) return unary();
    let left = binary(level + 1);
    while (LEVELS[level].includes(peek().type)) {
      const op = next();
      const right = binary(level + 1);
      left = { t: op.type === 'and' || op.type === 'or' ? 'logical' : 'binary', op: op.type, left, right, tok: op };
    }
    return left;
  }

  function unary() {
    if (check('!') || check('-')) {
      const op = next();
      return { t: 'unary', op: op.type, operand: unary(), tok: op };
    }
    return postfix();
  }

  function postfix() {
    let expr = primary();
    for (;;) {
      if (check('(')) {
        const open = next();
        const args = [];
        if (!check(')')) {
          do args.push(expression());
          while (accept(','));
        }
        expect(')', "Expect ')' after arguments.");
        expr = { t: 'call', callee: expr, args, tok: open };
      } else if (check('[')) {
        const open = next();
        const index = expression();
        expect(']', "Expect ']' after index.");
        expr = { t: 'index', object: expr, index, tok: open };
      } else {
        return expr;
      }
    }
  }

  function primary() {
    const tok = next();
    switch (tok.type) {
      case 'number':
        return { t: 'num', value: tok.value, tok };
      case 'string':
        return { t: 'str', value: tok.value, tok };
      case 'true':
      case 'false':
        return { t: 'bool', value: tok.type === 'true', tok };
      case 'nil':
        return { t: 'nil', tok };
      case 'ident':
        return { t: 'var', name: tok.text, tok };
      case '(': {
        const inner = expression();
        expect(')', "Expect ')' after expression.");
        return { t: 'group', inner, tok };
      }
      case '[': {
        const items = [];
        if (!check(']')) {
          do items.push(expression());
          while (accept(','));
        }
        expect(']', "Expect ']' after array items.");
        return { t: 'array', items, tok };
      }
      case 'fn': {
        expect('(', "Expect '(' after 'fn'.");
        const list = params();
        return { t: 'lambda', params: list, body: fnBody(), tok };
      }
      default:
        at -= 1;
        return fail('Expect expression.');
    }
  }

  return program();
}
