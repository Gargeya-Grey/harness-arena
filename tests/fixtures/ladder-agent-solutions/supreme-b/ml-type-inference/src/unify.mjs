import { InferError } from './errors.mjs';
import { showTypes } from './printer.mjs';

let subst = new Map();

export const resetSubst = () => {
  subst = new Map();
};

export function prune(type) {
  while (type.kind === 'var' && subst.has(type.id)) type = subst.get(type.id);
  return type;
}

export function apply(type) {
  type = prune(type);
  if (type.kind === 'var' || type.args.length === 0) return type;
  return { kind: 'con', name: type.name, args: type.args.map(apply) };
}

export function freeVars(type, into = new Set()) {
  type = prune(type);
  if (type.kind === 'var') into.add(type.id);
  else for (const arg of type.args) freeVars(arg, into);
  return into;
}

const occurs = (id, type) => {
  type = prune(type);
  return type.kind === 'var' ? type.id === id : type.args.some((arg) => occurs(id, arg));
};

class Clash {
  constructor(occursVar, occursType) {
    this.occursVar = occursVar;
    this.occursType = occursType;
  }
}

function go(a, b) {
  a = prune(a);
  b = prune(b);
  if (a.kind === 'var' || b.kind === 'var') {
    const [v, other] = a.kind === 'var' ? [a, b] : [b, a];
    if (other.kind === 'var' && other.id === v.id) return;
    if (occurs(v.id, other)) throw new Clash(v, apply(other));
    subst.set(v.id, other);
    return;
  }
  if (a.name !== b.name || a.args.length !== b.args.length) throw new Clash(null, null);
  for (let i = 0; i < a.args.length; i += 1) go(a.args[i], b.args[i]);
}

export function unify(expected, found, line, col) {
  const e = apply(expected);
  const f = apply(found);
  try {
    go(e, f);
  } catch (clash) {
    if (!(clash instanceof Clash)) throw clash;
    if (clash.occursVar) {
      const [v, t] = showTypes([clash.occursVar, clash.occursType]);
      throw new InferError(`infinite type: ${v} = ${t}`, line, col);
    }
    const [a, b] = showTypes([e, f]);
    throw new InferError(`type mismatch: expected ${a} but found ${b}`, line, col);
  }
}
