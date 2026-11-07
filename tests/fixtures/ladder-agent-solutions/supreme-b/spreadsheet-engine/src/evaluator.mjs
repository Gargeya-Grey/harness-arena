import { inGrid } from './refs.mjs';
import { makeError as err, isError } from './values.mjs';
import { toNumber, toText, compareValues } from './coerce.mjs';
import { FUNCTIONS } from './functions.mjs';

function arithmetic(op, left, right) {
  if (isError(left)) return left;
  if (isError(right)) return right;
  const a = toNumber(left);
  if (isError(a)) return a;
  const b = toNumber(right);
  if (isError(b)) return b;
  let result;
  if (op === '+') result = a + b;
  else if (op === '-') result = a - b;
  else if (op === '*') result = a * b;
  else if (op === '/') {
    if (b === 0) return err('#DIV/0!');
    result = a / b;
  } else {
    if (a === 0 && b === 0) return err('#NUM!');
    if (a === 0 && b < 0) return err('#DIV/0!');
    result = a ** b;
  }
  return Number.isFinite(result) ? result + 0 : err('#NUM!');
}

function comparison(op, left, right) {
  if (isError(left)) return left;
  if (isError(right)) return right;
  const c = compareValues(left, right);
  switch (op) {
    case '=': return c === 0;
    case '<>': return c !== 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    default: return c >= 0;
  }
}

/** The value of a formula (never empty). getCell({ col, row }) gives a stored value, null when empty. */
export function evaluate(ast, getCell) {
  const ctx = { scalar, items };

  function scalar(node) {
    switch (node.t) {
      case 'num':
      case 'str':
      case 'bool':
        return node.v;
      case 'ref':
        return inGrid(node) ? getCell(node) : err('#REF!');
      case 'range':
        return err('#VALUE!');
      case 'name':
        return err('#NAME?');
      case 'unary': {
        const v = scalar(node.x);
        if (node.op === '+' || isError(v)) return v;
        const n = toNumber(v);
        return isError(n) ? n : 0 - n;
      }
      case 'bin': {
        const left = scalar(node.l);
        const right = scalar(node.r);
        if (node.op === '&') {
          if (isError(left)) return left;
          if (isError(right)) return right;
          return toText(left) + toText(right);
        }
        if ('+-*/^'.includes(node.op)) return arithmetic(node.op, left, right);
        return comparison(node.op, left, right);
      }
      case 'call': {
        const fn = FUNCTIONS[node.name];
        if (!fn) return err('#NAME?');
        if (node.args.length < fn.arity[0] || node.args.length > fn.arity[1]) return err('#VALUE!');
        return fn.run(node.args, ctx);
      }
      default:
        throw new Error(`unknown node ${node.t}`);
    }
  }

  function items(node) {
    if (node.t === 'range') {
      if (!node.ok) return [{ cell: true, value: err('#REF!') }];
      const out = [];
      for (let row = node.r1; row <= node.r2; row += 1) for (let col = node.c1; col <= node.c2; col += 1) out.push({ cell: true, value: getCell({ col, row }) });
      return out;
    }
    if (node.t === 'ref') return [{ cell: true, value: scalar(node) }];
    return [{ cell: false, value: scalar(node) }];
  }

  const value = scalar(ast);
  return value === null ? 0 : value;
}
