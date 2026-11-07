export const PATCH_CODES = Object.freeze(['bad-header', 'bad-hunk-header', 'bad-hunk-line', 'count-mismatch']);

export class PatchError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PatchError';
    this.code = code;
  }
}
