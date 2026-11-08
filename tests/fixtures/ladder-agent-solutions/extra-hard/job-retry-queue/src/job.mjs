export function createJob({ id, seq, name, payload, options, now }) {
  const { key = null, priority = 0, maxAttempts = 3, delayMs = 0 } = options;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be a whole number of at least 1');
  return {
    id,
    seq,
    name,
    payload,
    key,
    priority,
    maxAttempts,
    state: 'queued', // queued, running, done, dead or cancelled
    attempts: 0,
    runAt: now + delayMs,
    createdAt: now,
    finishedAt: null,
    lastError: null,
    result: null,
  };
}

// What callers and handlers get: a copy, never the live record.
export function snapshot(job) {
  return { ...job, payload: structuredClone(job.payload), result: structuredClone(job.result) };
}
