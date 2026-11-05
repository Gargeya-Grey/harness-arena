// Pure job-list comparison for the shared job watch (shell.js). No DOM, so node:test can load it.
const DONE = new Set(['passed', 'failed', 'stopped']);

// `before`: Map of job id -> status from the previous poll, or null on the first poll.
// Returns the jobs that ended since that poll: a job seen running or stopping that is now done,
// and a job that started and ended between two polls. The first poll reports nothing, so jobs
// that ended before the page opened do not fire.
export function finishedJobs(before, jobs) {
  if (!before) return [];
  return jobs.filter((job) => {
    if (!DONE.has(job.status)) return false;
    const was = before.get(job.id);
    return was === undefined || was === 'running' || was === 'stopping';
  });
}
