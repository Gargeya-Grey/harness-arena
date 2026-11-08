// Every user-facing failure (lexer, parser, type checker) is an InferError.
// line and col are 1-based; see SPEC.md section 1.
export class InferError extends Error {
  constructor(message, line, col) {
    super(message);
    this.name = 'InferError';
    this.line = line;
    this.col = col;
  }
}
