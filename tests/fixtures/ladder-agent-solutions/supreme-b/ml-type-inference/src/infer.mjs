import { InferError } from './errors.mjs';
import { tInt, tBool, tString, tUnit, tArrow, tList, tTuple, newVar } from './types.mjs';
import { unify, apply, freeVars, resetSubst } from './unify.mjs';
import { showType } from './printer.mjs';

const mono = (type) => ({ vars: [], type });
const extend = (env, name, scheme) => ({ name, scheme, next: env });

function lookup(env, name) {
  for (let e = env; e; e = e.next) if (e.name === name) return e.scheme;
  return null;
}

function instantiate(scheme) {
  if (!scheme.vars.length) return scheme.type;
  const fresh = new Map(scheme.vars.map((id) => [id, newVar()]));
  const walk = (type) => {
    type = apply(type);
    if (type.kind === 'var') return fresh.get(type.id) || type;
    return type.args.length ? { kind: 'con', name: type.name, args: type.args.map(walk) } : type;
  };
  return walk(scheme.type);
}

function generalize(env, type) {
  type = apply(type);
  const inEnv = new Set();
  const seen = new Set();
  for (let e = env; e; e = e.next) {
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    for (const id of freeVars(e.scheme.type)) if (!e.scheme.vars.includes(id)) inEnv.add(id);
  }
  return { vars: [...freeVars(type)].filter((id) => !inEnv.has(id)), type };
}

function inferPat(p, binds) {
  switch (p.k) {
    case 'pwild':
      return newVar();
    case 'pvar': {
      if (binds.has(p.name)) throw new InferError(`duplicate variable ${p.name}`, p.line, p.col);
      const v = newVar();
      binds.set(p.name, v);
      return v;
    }
    case 'pint':
      return tInt;
    case 'pstring':
      return tString;
    case 'pbool':
      return tBool;
    case 'punit':
      return tUnit;
    case 'pnil':
      return tList(newVar());
    case 'ptuple':
      return tTuple(p.items.map((item) => inferPat(item, binds)));
    case 'plist': {
      const first = inferPat(p.items[0], binds);
      for (const item of p.items.slice(1)) unify(first, inferPat(item, binds), item.line, item.col);
      return tList(first);
    }
    case 'pcons': {
      const head = inferPat(p.head, binds);
      const tail = inferPat(p.tail, binds);
      unify(tList(head), tail, p.tail.line, p.tail.col);
      return tail;
    }
    default:
      throw new Error(`unknown pattern ${p.k}`);
  }
}

const INT_OPS = new Set(['+', '-', '*', '/']);
const CMP_OPS = new Set(['<', '<=', '>', '>=']);

function inferExpr(n, env) {
  switch (n.k) {
    case 'int':
      return tInt;
    case 'string':
      return tString;
    case 'bool':
      return tBool;
    case 'unit':
      return tUnit;
    case 'var': {
      const scheme = lookup(env, n.name);
      if (!scheme) throw new InferError(`unbound variable ${n.name}`, n.line, n.col);
      return instantiate(scheme);
    }
    case 'fun': {
      const seen = new Set();
      let inner = env;
      const types = [];
      for (const param of n.params) {
        if (param.text !== '_') {
          if (seen.has(param.text)) throw new InferError(`duplicate variable ${param.text}`, param.line, param.col);
          seen.add(param.text);
        }
        const v = newVar();
        types.push(v);
        if (param.text !== '_') inner = extend(inner, param.text, mono(v));
      }
      let result = inferExpr(n.body, inner);
      for (let i = types.length - 1; i >= 0; i -= 1) result = tArrow(types[i], result);
      return result;
    }
    case 'app': {
      const tf = apply(inferExpr(n.fn, env));
      if (tf.kind === 'con' && tf.name === '->') {
        const ta = inferExpr(n.arg, env);
        unify(tf.args[0], ta, n.arg.line, n.arg.col);
        return tf.args[1];
      }
      if (tf.kind === 'var') {
        const ta = inferExpr(n.arg, env);
        const r = newVar();
        unify(tf, tArrow(ta, r), n.line, n.col);
        return r;
      }
      throw new InferError(`not a function: ${showType(tf)}`, n.line, n.col);
    }
    case 'let': {
      let t1;
      if (n.rec) {
        const a = newVar();
        t1 = inferExpr(n.value, n.name === '_' ? env : extend(env, n.name, mono(a)));
        unify(a, t1, n.nameLine, n.nameCol);
      } else {
        t1 = inferExpr(n.value, env);
      }
      const scheme = generalize(env, t1);
      return inferExpr(n.body, n.name === '_' ? env : extend(env, n.name, scheme));
    }
    case 'if': {
      const tc = inferExpr(n.cond, env);
      unify(tBool, tc, n.cond.line, n.cond.col);
      const ta = inferExpr(n.yes, env);
      const tb = inferExpr(n.no, env);
      unify(ta, tb, n.no.line, n.no.col);
      return ta;
    }
    case 'tuple':
      return tTuple(n.items.map((item) => inferExpr(item, env)));
    case 'list': {
      if (!n.items.length) return tList(newVar());
      const first = inferExpr(n.items[0], env);
      for (const item of n.items.slice(1)) unify(first, inferExpr(item, env), item.line, item.col);
      return tList(first);
    }
    case 'bin': {
      const { op, left, right } = n;
      const tl = inferExpr(left, env);
      const want = INT_OPS.has(op) || CMP_OPS.has(op) ? tInt : op === '^' ? tString : op === '&&' || op === '||' ? tBool : null;
      if (want) {
        unify(want, tl, left.line, left.col);
        unify(want, inferExpr(right, env), right.line, right.col);
        return CMP_OPS.has(op) ? tBool : want;
      }
      const tr = inferExpr(right, env);
      if (op === '::') {
        unify(tList(tl), tr, right.line, right.col);
        return tr;
      }
      unify(tl, tr, right.line, right.col);
      return tBool;
    }
    case 'match': {
      const ts = inferExpr(n.scrutinee, env);
      let result = null;
      for (const arm of n.arms) {
        const binds = new Map();
        const tp = inferPat(arm.pattern, binds);
        unify(ts, tp, arm.pattern.line, arm.pattern.col);
        let inner = env;
        for (const [name, type] of binds) inner = extend(inner, name, mono(type));
        const tb = inferExpr(arm.body, inner);
        if (result === null) result = tb;
        else unify(result, tb, arm.body.line, arm.body.col);
      }
      return result;
    }
    default:
      throw new Error(`unknown node ${n.k}`);
  }
}

export function infer(ast) {
  resetSubst();
  return apply(inferExpr(ast, null));
}
