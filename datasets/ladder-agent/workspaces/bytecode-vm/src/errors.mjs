// Every failure that SPEC.md describes (syntax, compile, runtime) is a LangError.
// line and column are 1-based. trace is an array of strings (see SPEC.md section 9).
// output is the array of lines that print() had written before the failure.
export class LangError extends Error {
  constructor(kind, message, line, column, trace = [], output = []) {
    super(message);
    this.name = 'LangError';
    this.kind = kind;
    this.line = line;
    this.column = column;
    this.trace = trace;
    this.output = output;
  }
}
