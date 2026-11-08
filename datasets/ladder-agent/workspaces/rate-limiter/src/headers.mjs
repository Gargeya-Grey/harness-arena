// The HTTP headers for a check() result. Times are whole seconds.
export function toHeaders(result) {
  const headers = {
    'ratelimit-limit': String(result.limit),
    'ratelimit-remaining': String(result.remaining),
    'ratelimit-reset': String(Math.round(result.resetMs / 1000)),
  };
  if (!result.allowed) headers['retry-after'] = String(Math.floor(result.retryAfterMs / 1000));
  return headers;
}
