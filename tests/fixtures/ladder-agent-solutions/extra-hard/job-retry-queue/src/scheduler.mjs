import { compareJobs } from './order.mjs';

// The jobs that may start now, best first, at most `limit` of them.
// `canRun(job)` lets the caller skip jobs it cannot handle without using up slots.
export function selectDue(jobs, now, limit, canRun = () => true) {
  if (limit <= 0) return [];
  return [...jobs]
    .filter((job) => job.state === 'queued' && job.runAt <= now && canRun(job))
    .sort(compareJobs)
    .slice(0, limit);
}
