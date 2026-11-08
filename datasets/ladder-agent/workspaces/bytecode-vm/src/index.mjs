import { tokenize } from './lexer.mjs';
import { parse } from './parser.mjs';
import { compile } from './compiler.mjs';
import { execute } from './vm.mjs';

/** Runs a program (SPEC.md section 1). Returns { output } or throws a LangError. */
export function run(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  const program = compile(parse(tokenize(source)));
  return execute(program, options);
}

export { LangError } from './errors.mjs';
