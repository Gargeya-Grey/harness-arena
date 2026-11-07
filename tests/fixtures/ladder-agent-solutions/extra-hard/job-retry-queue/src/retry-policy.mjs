import { backoffDelay } from './backoff.mjs';

// After a failed attempt: retry with a wait, or give up. job.attempts already counts the failed attempt.
export function decide(job, error, backoff) {
  if (error && error.retryable === false) return { action: 'dead' };
  if (job.attempts >= job.maxAttempts) return { action: 'dead' };
  const asked = error && error.retryAfterMs;
  const delayMs = Number.isFinite(asked) && asked >= 0 ? asked : backoffDelay(backoff, job.attempts);
  return { action: 'retry', delayMs };
}
