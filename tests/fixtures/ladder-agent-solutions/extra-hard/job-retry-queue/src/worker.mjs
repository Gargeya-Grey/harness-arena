import { snapshot } from './job.mjs';
import { decide } from './retry-policy.mjs';

export function createWorker({ clock, pool, handlers, backoff, stats, emit }) {
  return {
    // Everything up to the first await runs at once, so a second runDue() already sees this job as running.
    async run(job) {
      const handler = handlers.get(job.name);
      job.state = 'running';
      job.attempts += 1;
      pool.take();
      try {
        const result = await handler(snapshot(job));
        job.state = 'done';
        job.result = result ?? null;
        job.lastError = null;
        job.finishedAt = clock.now();
        stats.count('completed');
        emit('done', snapshot(job));
      } catch (error) {
        job.lastError = String(error?.message ?? error);
        const verdict = decide(job, error, backoff);
        if (verdict.action === 'retry') {
          job.state = 'queued';
          job.runAt = clock.now() + verdict.delayMs;
          stats.count('retried');
          emit('retry', { job: snapshot(job), delayMs: verdict.delayMs });
        } else {
          job.state = 'dead';
          job.finishedAt = clock.now();
          stats.count('dead');
          emit('dead', snapshot(job));
        }
      } finally {
        pool.release();
      }
    },
  };
}
