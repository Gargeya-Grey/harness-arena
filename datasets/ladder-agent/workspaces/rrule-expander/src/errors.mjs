// Every rejected input of parse() and expand() is an RRuleError. SPEC.md section 3 lists the messages.
export class RRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RRuleError';
  }
}
