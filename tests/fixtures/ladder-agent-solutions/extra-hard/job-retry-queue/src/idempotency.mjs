// A key stands for one job of one name. It is held while that job waits or runs,
// and for ttlMs after the job finished with success. A dead or cancelled job gives it back.
export function holds(job, now, ttlMs) {
  if (job.state === 'dead' || job.state === 'cancelled') return false;
  if (job.state === 'done') return now < job.finishedAt + ttlMs;
  return true;
}

export function createKeyIndex() {
  const ids = new Map();
  const slot = (name, key) => `${name}\u0000${key}`;
  return {
    find: (name, key) => ids.get(slot(name, key)),
    remember: (name, key, id) => ids.set(slot(name, key), id),
  };
}
