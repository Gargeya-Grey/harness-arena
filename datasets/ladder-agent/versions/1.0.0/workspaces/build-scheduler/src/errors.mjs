export class GraphError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GraphError';
    this.code = code;
    Object.assign(this, details);
  }
}
