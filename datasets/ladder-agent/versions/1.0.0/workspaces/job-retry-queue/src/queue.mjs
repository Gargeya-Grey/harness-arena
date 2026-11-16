import { normalizeBackoff } from './backoff.mjs';
import { systemClock } from './clock.mjs';
import { createEmitter } from './events.mjs';
import { createKeyIndex, holds } from './idempotency.mjs';
import { createJob, snapshot } from './job.mjs';
import { createPool } from './pool.mjs';
import { selectDue } from './scheduler.mjs';
import { createStats } from './stats.mjs';
import { createWorker } from './worker.mjs';

// createQueue({ clock, concurrency, backoff, keyTtlMs })
//   register(name, handler)            handler(job) may return a value, or throw
//   enqueue(name, payload, options)    options: key, priority, maxAttempts, delayMs; returns a copy of the job
//   runDue()                           starts the due jobs that fit, resolves when those have settled; gives their number
//   get(id), cancel(id), retryDead(id), stats(), on(event, fn)
export function createQueue({ clock = systemClock, concurrency = 1, backoff, keyTtlMs = 60_000 } = {}) {
  const jobs = new Map();
  const handlers = new Map();
  const keys = createKeyIndex();
  const stats = createStats();
  const pool = createPool(concurrency);
  const emitter = createEmitter();
  const worker = createWorker({ clock, pool, handlers, backoff: normalizeBackoff(backoff), stats, emit: emitter.emit });
  let seq = 0;

  return {
    register(name, handler) {
      handlers.set(name, handler);
    },
    enqueue(name, payload, options = {}) {
      const now = clock.now();
      stats.count('enqueued');
      if (options.key != null) {
        const existing = jobs.get(keys.find(name, options.key));
        if (existing && holds(existing, now, keyTtlMs)) {
          stats.count('duplicates');
          return snapshot(existing);
        }
      }
      seq += 1;
      const job = createJob({ id: `job-${seq}`, seq, name, payload, options, now });
      jobs.set(job.id, job);
      if (job.key != null) keys.remember(name, job.key, job.id);
      return snapshot(job);
    },
    async runDue() {
      const due = selectDue(jobs.values(), clock.now(), pool.free());
      await Promise.all(due.map((job) => worker.run(job)));
      return due.length;
    },
    get(id) {
      const job = jobs.get(id);
      return job ? snapshot(job) : null;
    },
    cancel(id) {
      const job = jobs.get(id);
      if (!job || job.state === 'running') return false;
      job.state = 'cancelled';
      job.finishedAt = clock.now();
      stats.count('cancelled');
      return true;
    },
    retryDead(id) {
      const job = jobs.get(id);
      if (!job || job.state !== 'dead') return false;
      job.state = 'queued';
      job.runAt = clock.now();
      job.finishedAt = null;
      return true;
    },
    stats: () => stats.snapshot(),
    on: emitter.on,
  };
}
