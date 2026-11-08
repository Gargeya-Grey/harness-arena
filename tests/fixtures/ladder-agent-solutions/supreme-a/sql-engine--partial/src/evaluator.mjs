import { SqlError } from './errors.mjs';
import { like } from './like.mjs';

const type = (message) => new SqlError('type', message);
const lazy = true;

function number(value) {
  if (typeof value !== 'number') throw type(`${typeof value} is not a number`);
  return value;
}

function bool(value) {
  if (value !== null && typeof value !== 'boolean') throw type('a boolean is needed');
  return value;
}

/** -1, 0 or 1 for two non-NULL values of one type. */
export function compare(a, b) {
  if (typeof a !== typeof b) throw type(`cannot compare ${typeof a} with ${typeof b}`);
  return a < b ? -1 : a > b ? 1 : 0;
}

function arithmetic(op, a, b) {
  if (a === null || b === null) return null;
  const x = number(a);
  const y = number(b);
  if ((op === '/' || op === '%') && y === 0) throw new SqlError('div0', 'division by zero');
  return op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : x % y;
}

function comparison(op, a, b) {
  if (a === null || b === null) return null;
  const order = compare(a, b);
  switch (op) {
    case '=': return order === 0;
    case '<>': return order !== 0;
    case '<': return order < 0;
    case '<=': return order <= 0;
    case '>': return order > 0;
    default: return order >= 0;
  }
}

const and3 = (a, b) => (a === false || b === false ? false : a === null || b === null ? null : true);
const or3 = (a, b) => (a === true || b === true ? true : a === null || b === null ? null : false);
const not3 = (a) => (a === null ? null : !a);

export const keyOf = (value) => (value === null ? 'n' : typeof value === 'string' ? `s${value.length}:${value}` : `v${value}`);

function aggregate(e, group) {
  const values = e.arg === null ? group.map(() => 1) : group.map((row) => evaluate(e.arg, row, null));
  if (e.arg === null) return values.length;
  const present = values.filter((value) => value !== null);
  if (e.name === 'count') return e.distinct ? new Set(present.map(keyOf)).size : present.length;
  if (present.length === 0) return null;
  if (e.name === 'sum' || e.name === 'avg') {
    let sum = 0;
    for (const value of present) sum += number(value);
    return e.name === 'sum' ? sum : sum / values.length;
  }
  let best = present[0];
  for (const value of present) {
    const order = compare(value, best);
    if (e.name === 'min' ? order < 0 : order > 0) best = value;
  }
  return best;
}

/** The value of a bound expression on one row; `group` is the list of rows for aggregates. */
export function evaluate(e, row, group) {
  switch (e.t) {
    case 'lit': return e.v;
    case 'ref': return row[e.i];
    case 'un': {
      const v = evaluate(e.e, row, group);
      return e.op === '-' ? (v === null ? null : -number(v)) : not3(bool(v));
    }
    case 'bin': {
      const a = evaluate(e.l, row, group);
      if (e.op === 'and' && a === false) return false;
      if (e.op === 'or' && a === true) return true;
      const b = evaluate(e.r, row, group);
      if (e.op === 'and') return and3(bool(a), bool(b));
      if (e.op === 'or') return or3(bool(a), bool(b));
      if (e.op === '||') {
        if (a === null || b === null) return null;
        if (typeof a !== 'string' || typeof b !== 'string') throw type('|| needs strings');
        return a + b;
      }
      if (e.op === '+' || e.op === '-' || e.op === '*' || e.op === '/' || e.op === '%') return arithmetic(e.op, a, b);
      return comparison(e.op, a, b);
    }
    case 'isnull': {
      const isNull = evaluate(e.e, row, group) === null;
      return e.not ? !isNull : isNull;
    }
    case 'in': {
      const x = evaluate(e.e, row, group);
      if (x === null) return null;
      let sawNull = false;
      let found = false;
      for (const item of e.list) {
        const v = evaluate(item, row, group);
        if (v === null) sawNull = true;
        else if (compare(x, v) === 0) found = true;
      }
      const result = found ? true : sawNull ? null : false;
      return e.not ? not3(result) : result;
    }
    case 'between': {
      const x = evaluate(e.e, row, group);
      const lo = evaluate(e.lo, row, group);
      const hi = evaluate(e.hi, row, group);
      const result = and3(comparison('>=', x, lo), comparison('<=', x, hi));
      return e.not ? not3(result) : result;
    }
    case 'like': {
      const text = evaluate(e.e, row, group);
      const pattern = evaluate(e.pattern, row, group);
      if (text === null || pattern === null) return null;
      if (typeof text !== 'string' || typeof pattern !== 'string') throw type('LIKE needs strings');
      const result = like(text, pattern);
      return e.not ? !result : result;
    }
    case 'case': {
      for (const when of e.whens) if (bool(evaluate(when.c, row, group)) === true) return evaluate(when.v, row, group);
      return e.otherwise === null ? null : evaluate(e.otherwise, row, group);
    }
    case 'fn': {
      if (e.name === 'coalesce') {
        for (const arg of e.args) {
          const v = evaluate(arg, row, group);
          if (v !== null) return v;
        }
        return null;
      }
      const v = evaluate(e.args[0], row, group);
      if (v === null) return null;
      if (e.name === 'abs') return Math.abs(number(v));
      if (typeof v !== 'string') throw type(`${e.name} needs a string`);
      return e.name === 'length' ? v.length : e.name === 'upper' ? v.toUpperCase() : v.toLowerCase();
    }
    case 'agg': return aggregate(e, group);
    default: throw new Error(`unknown node ${e.t}`);
  }
}
