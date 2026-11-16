// The public entry point. typeOf(source) is what callers and tests use.
import { tokenize } from './lexer.mjs';
import { parse } from './parser.mjs';
import { infer } from './infer.mjs';
import { showType } from './printer.mjs';
import { InferError } from './errors.mjs';

/**
 * { ok: true, type: 'int -> int' }
 * { ok: false, error: { message, line, col } }
 */
export function typeOf(source) {
  try {
    const ast = parse(tokenize(source));
    return { ok: true, type: showType(infer(ast)) };
  } catch (error) {
    if (error instanceof InferError) return { ok: false, error: { message: error.message, line: error.line, col: error.col } };
    throw error;
  }
}
