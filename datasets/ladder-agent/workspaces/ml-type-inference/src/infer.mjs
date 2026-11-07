// infer(ast) -> the type of the whole program, with every substitution applied.
// The rules, their order and their error positions are in SPEC.md sections 5 and 6.
import { InferError } from './errors.mjs';
import { tInt, tBool, tString, tUnit, tArrow, tList, tTuple, newVar } from './types.mjs';
import { unify } from './unify.mjs';

export function infer(ast) {
  void [InferError, tInt, tBool, tString, tUnit, tArrow, tList, tTuple, newVar, unify];
  void ast;
  throw new Error('not implemented: infer');
}
