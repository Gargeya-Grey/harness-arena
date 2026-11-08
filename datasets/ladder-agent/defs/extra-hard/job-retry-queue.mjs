export default {
  slug: 'job-retry-queue',
  tier: {
    level: 4,
    human_minutes: 50,
    basis: 'Estimate from the size of the work, not a timed solve: about 14 separate faults in 8 of 12 files, roughly 25 minutes to find them by reading and running the code and 25 to fix and check them.',
  },
  tags: ['bugfix'],
  task: `Our job queue misbehaves in production.
- After a handler throws, the queue stops starting jobs. With concurrency 2, three failing jobs leave it idle for good.
- A job that fails every time runs one time more than its maxAttempts. The first retry waits twice the configured base time. Waits such as 22.5 ms are cut to 22 instead of being rounded up.
- Errors we mark as not retryable are retried anyway, and the retryAfterMs that a rate-limited API puts on its error is ignored.
- With a dozen jobs of the same priority, the job enqueued tenth starts before the job enqueued second.
- A job whose name has no registered handler is started anyway, fails, and uses up its attempts.
- The same idempotency key sent for two different job names is treated as one job. A key is held forever, even after its job died, so the caller can never submit it again. Duplicate submissions show up as new jobs in stats().
- cancel() accepts jobs that already finished, and that frees their key.
- retryDead() puts a job back, but the job dies again after its first failure.
- Changing the object that enqueue() or get() returned changes the queue's own record.

The rules we agreed on:
- maxAttempts is the total number of runs, the first one included. The wait before retry n (n is 1 for the first retry) is baseMs * factor^(n-1), rounded up to a whole millisecond and never above capMs.
- An error whose retryable is exactly false ends the job at once (state dead). If the error has a retryAfterMs that is a finite number of 0 or more, the retry waits exactly that long and the cap does not apply to it; any other value of retryAfterMs is ignored. Such a retry still uses up an attempt.
- Jobs start by higher priority first, then the job that became due first (runAt), then the one enqueued first.
- A job without a registered handler stays queued, is not counted as an attempt and does not take a slot; it runs once a handler is registered.
- An idempotency key belongs to a job name together with the key. It is held while the job is queued (also while it waits for a retry) or running, and for keyTtlMs after the job finished with success, counted from the time it finished. A dead job or a cancelled job gives its key back at once. A duplicate submission returns a copy of the held job, counts in stats().duplicates and does not count in stats().enqueued.
- cancel(id) works only on a queued job (waiting, delayed, or waiting for a retry) and returns true; for any other job, or an unknown id, it returns false and changes nothing.
- retryDead(id) works only on a dead job: it becomes queued and due now, with attempts 0 and finishedAt null, and the call returns true; otherwise false.
- enqueue(), get(), the job given to a handler and the events all hand out copies, results included.

Public exports stay as they are. The existing tests must keep passing and must not be edited; put any new tests in new files.`,
};
