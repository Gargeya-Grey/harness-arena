import { makeError as err, isError } from './values.mjs';
import { toNumber, toText, toBool, NUMBER_TEXT } from './coerce.mjs';

/** Numbers contributed by the arguments, or the first error. */
function collectNumbers(args, ctx) {
  const numbers = [];
  for (const arg of args) {
    for (const item of ctx.items(arg)) {
      const v = item.value;
      if (isError(v)) return v;
      if (item.cell) {
        if (typeof v === 'number') numbers.push(v);
        continue;
      }
      if (v === null) numbers.push(0);
      else if (typeof v === 'number') numbers.push(v);
      else {
        const n = toNumber(v);
        if (isError(n)) return n;
        numbers.push(n);
      }
    }
  }
  return numbers;
}

function finite(n) {
  return Number.isFinite(n) ? n + 0 : err('#NUM!');
}

/** Both arguments are evaluated first; an error in either comes before any coercion error. */
function twoNumbers(ctx, first, second) {
  const a = ctx.scalar(first);
  const b = second ? ctx.scalar(second) : 0;
  if (isError(a)) return a;
  if (isError(b)) return b;
  const x = toNumber(a);
  if (isError(x)) return x;
  const y = toNumber(b);
  return isError(y) ? y : [x, y];
}

function roundHalfAway(x, digits) {
  const factor = 10 ** digits;
  return Math.round(x * factor) / factor;
}

const sum = (list) => list.reduce((total, n) => total + n, 0);

export const FUNCTIONS = {
  SUM: { arity: [1, Infinity], run: (args, ctx) => { const n = collectNumbers(args, ctx); return isError(n) ? n : finite(sum(n)); } },
  AVERAGE: { arity: [1, Infinity], run: (args, ctx) => { const n = collectNumbers(args, ctx); if (isError(n)) return n; return n.length ? finite(sum(n) / n.length) : err('#DIV/0!'); } },
  MIN: { arity: [1, Infinity], run: (args, ctx) => { const n = collectNumbers(args, ctx); if (isError(n)) return n; return n.length ? n.reduce((a, b) => (b < a ? b : a)) : 0; } },
  MAX: { arity: [1, Infinity], run: (args, ctx) => { const n = collectNumbers(args, ctx); if (isError(n)) return n; return n.length ? n.reduce((a, b) => (b > a ? b : a)) : 0; } },
  COUNT: {
    arity: [1, Infinity],
    run: (args, ctx) => {
      let count = 0;
      for (const arg of args) {
        for (const item of ctx.items(arg)) {
          const v = item.value;
          if (isError(v)) continue;
          if (item.cell) {
            if (typeof v === 'number') count += 1;
          } else if (v === null || typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && NUMBER_TEXT.test(v.trim()))) count += 1;
        }
      }
      return count;
    },
  },
  COUNTA: {
    arity: [1, Infinity],
    run: (args, ctx) => {
      let count = 0;
      for (const arg of args) for (const item of ctx.items(arg)) if (!item.cell || item.value !== null) count += 1;
      return count;
    },
  },
  AND: { arity: [1, Infinity], run: (args, ctx) => logical(args, ctx, (list) => list.every(Boolean)) },
  OR: { arity: [1, Infinity], run: (args, ctx) => logical(args, ctx, (list) => list.some(Boolean)) },
  CONCAT: {
    arity: [1, Infinity],
    run: (args, ctx) => {
      let out = '';
      for (const arg of args) {
        for (const item of ctx.items(arg)) {
          if (isError(item.value)) return item.value;
          out += toText(item.value);
        }
      }
      return out;
    },
  },
  IF: {
    arity: [2, 3],
    run: (args, ctx) => {
      const c = ctx.scalar(args[0]);
      if (isError(c)) return c;
      const b = toBool(c);
      if (isError(b)) return b;
      if (b) return ctx.scalar(args[1]);
      return args[2] ? ctx.scalar(args[2]) : false;
    },
  },
  IFERROR: {
    arity: [2, 2],
    run: (args, ctx) => {
      const v = ctx.scalar(args[0]);
      return isError(v) ? ctx.scalar(args[1]) : v;
    },
  },
  NOT: {
    arity: [1, 1],
    run: (args, ctx) => {
      const v = ctx.scalar(args[0]);
      if (isError(v)) return v;
      const b = toBool(v);
      return isError(b) ? b : !b;
    },
  },
  ABS: { arity: [1, 1], run: (args, ctx) => { const r = twoNumbers(ctx, args[0], null); return isError(r) ? r : Math.abs(r[0]); } },
  ROUND: {
    arity: [1, 2],
    run: (args, ctx) => {
      const r = twoNumbers(ctx, args[0], args[1]);
      if (isError(r)) return r;
      return finite(roundHalfAway(r[0], Math.trunc(r[1])));
    },
  },
  MOD: {
    arity: [2, 2],
    run: (args, ctx) => {
      const r = twoNumbers(ctx, args[0], args[1]);
      if (isError(r)) return r;
      const [a, b] = r;
      if (b === 0) return err('#DIV/0!');
      return finite((a % b) + 0);
    },
  },
  LEN: {
    arity: [1, 1],
    run: (args, ctx) => {
      const v = ctx.scalar(args[0]);
      return isError(v) ? v : [...toText(v)].length;
    },
  },
};

function logical(args, ctx, combine) {
  const values = [];
  for (const arg of args) {
    for (const item of ctx.items(arg)) {
      const v = item.value;
      if (isError(v)) return v;
      if (item.cell) {
        if (typeof v === 'boolean') values.push(v);
        else if (typeof v === 'number') values.push(v !== 0);
      } else {
        const b = toBool(v);
        if (isError(b)) return b;
        values.push(b);
      }
    }
  }
  return values.length ? combine(values) : err('#VALUE!');
}
