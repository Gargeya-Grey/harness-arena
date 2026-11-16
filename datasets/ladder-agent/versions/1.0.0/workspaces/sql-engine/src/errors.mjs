export class SqlError extends Error {
  constructor(code, message, position) {
    super(message);
    this.name = 'SqlError';
    this.code = code;
    if (position !== undefined) this.position = position;
  }
}
