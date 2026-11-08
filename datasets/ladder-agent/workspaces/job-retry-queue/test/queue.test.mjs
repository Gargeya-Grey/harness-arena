import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, manualClock } from '../src/index.mjs';

const make = (options = {}) => {
  const clock = manualClock(0);
  return { clock, queue: createQueue({ clock, ...options }) };
};

test('a job runs its handler with a copy of the job and ends done', async () => {
  const { queue } = make();
  const seen = [];
  queue.register('mail', (job) => {
    seen.push(job.payload.to);
    return 'sent';
  });
  const job = queue.enqueue('mail', { to: 'a@x' });
  assert.equal(job.state, 'queued');
  assert.equal(await queue.runDue(), 1);
  assert.deepEqual(seen, ['a@x']);
  assert.equal(queue.get(job.id).state, 'done');
  assert.equal(queue.get(job.id).result, 'sent');
});

test('a higher priority starts first', async () => {
  const { queue } = make();
  const order = [];
  queue.register('t', (job) => order.push(job.payload));
  queue.enqueue('t', 'low', { priority: 0 });
  queue.enqueue('t', 'high', { priority: 5 });
  await queue.runDue();
  await queue.runDue();
  assert.deepEqual(order, ['high', 'low']);
});

test('concurrency limits the jobs that run at the same moment', async () => {
  const { queue } = make({ concurrency: 2 });
  const gates = [];
  queue.register('t', () => new Promise((resolve) => gates.push(resolve)));
  for (let i = 0; i < 3; i += 1) queue.enqueue('t', i);
  const first = queue.runDue();
  assert.equal(await queue.runDue(), 0);
  gates.forEach((open) => open());
  assert.equal(await first, 2);
});

test('a delayed job waits for its time', async () => {
  const { queue, clock } = make();
  queue.register('t', () => {});
  queue.enqueue('t', 1, { delayMs: 500 });
  assert.equal(await queue.runDue(), 0);
  clock.set(600);
  assert.equal(await queue.runDue(), 1);
});

test('an unknown job id gives null', () => {
  assert.equal(make().queue.get('nope'), null);
});

test('maxAttempts must be a whole number of at least 1', () => {
  const { queue } = make();
  assert.throws(() => queue.enqueue('t', 1, { maxAttempts: 0 }), RangeError);
  assert.throws(() => queue.enqueue('t', 1, { maxAttempts: 1.5 }), RangeError);
});
