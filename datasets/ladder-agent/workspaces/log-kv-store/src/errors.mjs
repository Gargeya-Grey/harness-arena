export class CorruptionError extends Error {
  constructor(reason, details = {}) {
    super(`corrupt store: ${reason}${details.segment !== undefined ? ` in segment ${details.segment}` : ''}`);
    this.name = 'CorruptionError';
    this.reason = reason;
    Object.assign(this, details);
  }
}
