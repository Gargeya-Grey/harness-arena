export const STATUS = Object.freeze({
  'bad-newline': 400,
  'bad-request-line': 400,
  'bad-version': 505,
  'bad-target': 400,
  'uri-too-long': 414,
  'bad-header': 400,
  'headers-too-large': 431,
  'bad-host': 400,
  'bad-length': 400,
  'unsupported-te': 501,
  'body-too-large': 413,
  'bad-chunk': 400,
  'bad-trailer': 400,
  incomplete: 400,
});

/** The error object a push() or end() returns. */
export function httpError(code, message = code) {
  return { code, status: STATUS[code], message };
}
