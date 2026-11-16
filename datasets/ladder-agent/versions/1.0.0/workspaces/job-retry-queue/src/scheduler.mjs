import { compareJobs } from './order.mjs';

// The jobs that may start now, best first, at most `limit` of them.
export function selectDue(jobs, now, limit) {
  if (limit <= 0) return [];
  return [...jobs]
    .filter((job) => job.state === 'queued' && job.runAt <= now)
    .sort(compareJobs)
    .slice(0, limit);
}
