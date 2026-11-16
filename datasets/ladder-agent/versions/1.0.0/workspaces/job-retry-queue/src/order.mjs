// Higher priority first, then the job that became due first, then the one enqueued first.
export function compareJobs(a, b) {
  return b.priority - a.priority || a.runAt - b.runAt || (a.id < b.id ? -1 : 1);
}
