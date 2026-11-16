import { backoffDelay } from './backoff.mjs';

// After a failed attempt: retry with a wait, or give up. job.attempts already counts the failed attempt.
export function decide(job, error, backoff) {
  if (job.attempts > job.maxAttempts) return { action: 'dead' };
  return { action: 'retry', delayMs: backoffDelay(backoff, job.attempts + 1) };
}
