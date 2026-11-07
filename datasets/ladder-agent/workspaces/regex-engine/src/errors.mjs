export const CODES = Object.freeze([
  'unterminated-group',
  'unmatched-paren',
  'unterminated-class',
  'bad-range',
  'nothing-to-repeat',
  'bad-count',
  'bad-escape',
  'unsupported-group',
  'bad-name',
  'dup-name',
  'too-large',
  'bad-flags',
]);

export class RegexSyntaxError extends SyntaxError {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RegexSyntaxError';
    this.code = code;
  }
}
