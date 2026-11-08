// The HTTP headers for a check() result. Times are whole seconds, rounded up,
// so a client that waits that long is never early.
export function toHeaders(result) {
  const headers = {
    'ratelimit-limit': String(result.limit),
    'ratelimit-remaining': String(result.remaining),
    'ratelimit-reset': String(Math.ceil(result.resetMs / 1000)),
  };
  if (!result.allowed && result.retryAfterMs !== null) headers['retry-after'] = String(Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
  return headers;
}
