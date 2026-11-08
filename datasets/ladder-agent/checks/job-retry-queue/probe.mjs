// Hidden probes for ladder-agent-job-retry-queue; expected.json holds the answers.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return error.constructor.name;
  }
};
const make = async (load, options = {}) => {
  const { createQueue, manualClock } = await lib(load);
  const clock = manualClock(0);
  return { clock, queue: createQueue({ clock, ...options }) };
};
const failWith = (extra = {}) => () => {
  throw Object.assign(new Error('x'), extra);
};
const BACKOFF = { baseMs: 10, factor: 2, capMs: 100_000 };

// One job that always fails. The clock jumps to each retry time. Gives the waits and the end state.
async function lifecycle(load, backoff, maxAttempts, error = {}) {
  const { queue, clock } = await make(load, { backoff });
  let calls = 0;
  queue.register('t', () => {
    calls += 1;
    throw Object.assign(new Error('x'), error);
  });
  const job = queue.enqueue('t', null, { maxAttempts });
  const waits = [];
  for (let i = 0; i < 12; i += 1) {
    if (!(await queue.runDue())) break;
    const now = queue.get(job.id);
    if (now.state !== 'queued') break;
    waits.push(now.runAt - clock.now());
    clock.set(now.runAt);
  }
  const end = queue.get(job.id);
  return { waits, calls, state: end.state, attempts: end.attempts };
}

export const probes = [
  {
    name: 'keeps priority order and the shape of a job',
    run: async ({ load }) => {
      const { queue } = await make(load);
      const order = [];
      queue.register('t', (job) => order.push(job.payload));
      const first = queue.enqueue('t', 'a', { priority: 1 });
      queue.enqueue('t', 'b', { priority: 9 });
      queue.enqueue('t', 'c', { priority: 5 });
      for (let i = 0; i < 3; i += 1) await queue.runDue();
      return { order, keys: Object.keys(first).sort() };
    },
  },
  {
    name: 'a job runs maxAttempts times in all, not one more',
    run: async ({ load }) => [await lifecycle(load, BACKOFF, 3), await lifecycle(load, BACKOFF, 1), await lifecycle(load, BACKOFF, 2)],
  },
  {
    name: 'the first retry waits the base time and each next one the factor more',
    run: async ({ load }) => lifecycle(load, { baseMs: 100, factor: 2, capMs: 100_000 }, 5),
  },
  {
    name: 'the wait stops growing at the cap',
    run: async ({ load }) => lifecycle(load, { baseMs: 100, factor: 3, capMs: 500 }, 6),
  },
  {
    name: 'a fractional wait is rounded up to a whole millisecond',
    run: async ({ load }) => [(await lifecycle(load, { baseMs: 10, factor: 1.5, capMs: 100_000 }, 5)).waits, (await lifecycle(load, { baseMs: 7, factor: 1.1, capMs: 100_000 }, 4)).waits],
  },
  {
    name: 'an error that is marked not retryable ends the job at once',
    run: async ({ load }) => [await lifecycle(load, BACKOFF, 5, { retryable: false }), await lifecycle(load, BACKOFF, 2, { retryable: true }), await lifecycle(load, BACKOFF, 2, { retryable: 'no' })],
  },
  {
    name: 'retryAfterMs of the error replaces the backoff wait',
    run: async ({ load }) => ({
      fixed: await lifecycle(load, { baseMs: 100, factor: 2, capMs: 200 }, 4, { retryAfterMs: 5000 }),
      zero: await lifecycle(load, BACKOFF, 3, { retryAfterMs: 0 }),
    }),
  },
  {
    name: 'an unusable retryAfterMs falls back to the backoff wait',
    run: async ({ load }) => {
      const out = [];
      for (const retryAfterMs of [-5, NaN, '300', Infinity, null]) out.push((await lifecycle(load, { baseMs: 100, factor: 2, capMs: 100_000 }, 3, { retryAfterMs })).waits);
      return out;
    },
  },
  {
    name: 'jobs of equal rank start in the order they were enqueued, also past ten jobs',
    run: async ({ load }) => {
      const { queue, clock } = await make(load);
      const order = [];
      queue.register('t', (job) => order.push(job.payload));
      for (let i = 0; i < 12; i += 1) queue.enqueue('t', i);
      for (let i = 0; i < 12; i += 1) await queue.runDue();

      const second = await make(load);
      const seen = [];
      second.queue.register('t', (job) => seen.push(job.payload));
      second.queue.enqueue('t', 'low');
      second.queue.enqueue('t', 'late', { priority: 1, delayMs: 50 });
      second.queue.enqueue('t', 'prompt', { priority: 1 });
      second.clock.set(100);
      for (let i = 0; i < 3; i += 1) await second.queue.runDue();
      return { order, seen, clock: clock.now() };
    },
  },
  {
    name: 'keeps a delayed job waiting until its time',
    run: async ({ load }) => {
      const { queue, clock } = await make(load);
      queue.register('t', () => {});
      queue.enqueue('t', 1, { delayMs: 100 });
      const out = [await queue.runDue()];
      clock.set(99);
      out.push(await queue.runDue());
      clock.set(100);
      out.push(await queue.runDue());
      return out;
    },
  },
  {
    name: 'a failing job gives its slot back',
    run: async ({ load }) => {
      const { queue } = await make(load, { concurrency: 2 });
      queue.register('bad', failWith());
      queue.register('good', () => {});
      for (let i = 0; i < 3; i += 1) queue.enqueue('bad', i, { maxAttempts: 1 });
      const out = [await queue.runDue(), await queue.runDue()];
      for (let i = 0; i < 4; i += 1) queue.enqueue('good', i);
      out.push(await queue.runDue(), await queue.runDue());
      return out;
    },
  },
  {
    name: 'keeps the limit on jobs that run at the same moment',
    run: async ({ load }) => {
      const { queue } = await make(load, { concurrency: 2 });
      const gates = [];
      queue.register('t', () => new Promise((resolve) => gates.push(resolve)));
      for (let i = 0; i < 5; i += 1) queue.enqueue('t', i);
      const first = queue.runDue();
      const second = await queue.runDue();
      const open = gates.length;
      gates.forEach((release) => release());
      const done = await first;
      const third = queue.runDue();
      const started = gates.length - open;
      gates.forEach((release) => release());
      return { second, open, done, started, third: await third };
    },
  },
  {
    name: 'a job without a handler waits and does not take a slot',
    run: async ({ load }) => {
      const { queue } = await make(load);
      queue.register('y', () => 'ok');
      const x = queue.enqueue('x', 1);
      const y = queue.enqueue('y', 2);
      const first = await queue.runDue();
      const before = queue.get(x.id);
      queue.register('x', () => 'late');
      const second = await queue.runDue();
      return { first, x: [before.state, before.attempts, queue.get(x.id).state, queue.get(x.id).result], y: queue.get(y.id).state, second };
    },
  },
  {
    name: 'the same key twice is one job, and a duplicate is not counted as a new job',
    run: async ({ load }) => {
      const { queue } = await make(load);
      const a = queue.enqueue('mail', 1, { key: 'k' });
      const b = queue.enqueue('mail', 2, { key: 'k' });
      const c = queue.enqueue('mail', 3, { key: 'k', priority: 9 });
      const d = queue.enqueue('mail', 4, { key: 'other' });
      const s = queue.stats();
      return { same: [a.id === b.id, b.id === c.id, d.id === a.id], payload: c.payload, priority: c.priority, enqueued: s.enqueued, duplicates: s.duplicates };
    },
  },
  {
    name: 'the same key under another job name is another job',
    run: async ({ load }) => {
      const { queue } = await make(load);
      const a = queue.enqueue('mail', 1, { key: 'k' });
      const b = queue.enqueue('sms', 1, { key: 'k' });
      const c = queue.enqueue('sms', 1, { key: 'k' });
      return [a.id === b.id, b.id === c.id, queue.stats().enqueued];
    },
  },
  {
    name: 'after success a key is held for the ttl, counted from the end of the job',
    run: async ({ load }) => {
      const { queue, clock } = await make(load, { keyTtlMs: 1000 });
      queue.register('t', () => 'r');
      const job = queue.enqueue('t', 1, { key: 'k' });
      clock.set(500);
      await queue.runDue();
      const out = [];
      for (const at of [500, 1499, 1500, 9000]) {
        clock.set(at);
        const again = queue.enqueue('t', 2, { key: 'k' });
        out.push(again.id === job.id);
        if (again.id !== job.id) break;
      }
      return out;
    },
  },
  {
    name: 'a dead job gives its key back at once, a job that is waiting to retry keeps it',
    run: async ({ load }) => {
      const { queue, clock } = await make(load);
      queue.register('t', failWith());
      const job = queue.enqueue('t', 1, { key: 'k', maxAttempts: 2 });
      await queue.runDue();
      const retrying = queue.enqueue('t', 1, { key: 'k' });
      clock.set(1_000_000);
      await queue.runDue();
      const dead = queue.get(job.id).state;
      const fresh = queue.enqueue('t', 1, { key: 'k' });
      const s = queue.stats();
      return { sameWhileRetrying: retrying.id === job.id, dead, fresh: [fresh.id === job.id, fresh.state, fresh.attempts], duplicates: s.duplicates };
    },
  },
  {
    name: 'only a waiting job can be cancelled, and it gives its key back',
    run: async ({ load }) => {
      const { queue } = await make(load, { concurrency: 5 });
      const gates = [];
      queue.register('ok', () => 'r');
      queue.register('slow', () => new Promise((resolve) => gates.push(resolve)));
      queue.register('bad', failWith());
      const waiting = queue.enqueue('ok', 1, { key: 'w' });
      const cancelled = queue.cancel(waiting.id);
      const again = queue.enqueue('ok', 1, { key: 'w' });
      const done = queue.enqueue('ok', 2);
      const running = queue.enqueue('slow', 3);
      const dead = queue.enqueue('bad', 4, { maxAttempts: 1 });
      const pending = queue.runDue();
      await Promise.resolve();
      const results = [queue.cancel(done.id), queue.cancel(running.id), queue.cancel(dead.id), queue.cancel('nope')];
      gates.forEach((release) => release());
      await pending;
      await queue.runDue();
      const afterRun = [queue.cancel(done.id), queue.cancel(dead.id), queue.cancel(running.id)];
      return { cancelled, newKey: again.id === waiting.id, results, afterRun, states: [done.id, running.id, dead.id].map((id) => queue.get(id).state), waiting: queue.get(waiting.id).state };
    },
  },
  {
    name: 'retryDead starts a dead job again with a fresh count of attempts',
    run: async ({ load }) => {
      const { queue, clock } = await make(load);
      queue.register('t', failWith());
      queue.register('fine', () => 1);
      const job = queue.enqueue('t', 1, { maxAttempts: 2 });
      const ok = queue.enqueue('fine', 1);
      const out = { early: queue.retryDead(job.id) };
      for (let i = 0; i < 4; i += 1) {
        await queue.runDue();
        clock.advance(100_000);
      }
      out.dead = [queue.get(job.id).state, queue.get(job.id).attempts, queue.get(job.id).finishedAt !== null];
      out.again = queue.retryDead(job.id);
      const revived = queue.get(job.id);
      out.revived = [revived.state, revived.attempts, revived.finishedAt];
      await queue.runDue();
      const after = queue.get(job.id);
      out.afterOneFailure = [after.state, after.attempts];
      out.others = [queue.retryDead(ok.id), queue.retryDead('nope'), queue.retryDead(job.id)];
      return out;
    },
  },
  {
    name: 'callers and handlers get copies of the job, never the live record',
    run: async ({ load }) => {
      const { queue } = await make(load);
      queue.register('t', (job) => {
        job.payload.items.push('x');
        job.priority = 99;
        job.state = 'weird';
        return { n: 1 };
      });
      const job = queue.enqueue('t', { items: ['a'] });
      job.payload.items.push('b');
      job.state = 'weird';
      const seen = queue.get(job.id);
      seen.payload.items.push('c');
      await queue.runDue();
      const end = queue.get(job.id);
      end.result.n = 2;
      return { payload: queue.get(job.id).payload, priority: queue.get(job.id).priority, state: queue.get(job.id).state, result: queue.get(job.id).result, same: queue.get(job.id) === queue.get(job.id) };
    },
  },
  {
    name: 'stats count each thing once',
    run: async ({ load }) => {
      const { queue, clock } = await make(load, { concurrency: 3 });
      queue.register('ok', () => 1);
      queue.register('bad', failWith());
      queue.enqueue('ok', 1, { key: 'a' });
      queue.enqueue('ok', 1, { key: 'a' });
      queue.enqueue('bad', 2, { maxAttempts: 2 });
      const gone = queue.enqueue('ok', 3);
      queue.cancel(gone.id);
      await queue.runDue();
      clock.advance(1_000_000);
      await queue.runDue();
      return queue.stats();
    },
  },
  {
    name: 'keeps a maxAttempts that is not a whole number refused',
    run: async ({ load }) => {
      const { queue } = await make(load);
      return [0, -1, 2.5, NaN].map((maxAttempts) => attempt(() => queue.enqueue('t', 1, { maxAttempts })));
    },
  },
  {
    name: 'the events carry the wait of a retry, and a dead job is announced once',
    run: async ({ load }) => {
      const { queue, clock } = await make(load, { backoff: { baseMs: 50, factor: 2, capMs: 1000 } });
      const log = [];
      queue.on('retry', (event) => log.push(['retry', event.delayMs, event.job.attempts]));
      queue.on('dead', (job) => log.push(['dead', job.attempts, job.state]));
      queue.on('done', (job) => log.push(['done', job.id]));
      queue.register('t', failWith());
      queue.enqueue('t', 1, { maxAttempts: 3 });
      for (let i = 0; i < 5; i += 1) {
        await queue.runDue();
        clock.advance(1000);
      }
      return log;
    },
  },
];
