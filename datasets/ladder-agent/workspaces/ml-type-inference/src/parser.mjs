// parse(tokens) -> ast. tokens come from lexer.mjs and end with an 'eof' token.
// The grammar, the precedence table and every syntax error message are in SPEC.md
// sections 3 and 4. The shape of the AST is yours; infer.mjs reads it.
// Throw InferError(message, line, col) for a syntax error.
import { InferError } from './errors.mjs';

export function parse(tokens) {
  void InferError;
  void tokens;
  throw new Error('not implemented: parse');
}
