import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, createQueue, manualClock } from '../src/index.mjs';

const failing = () => {
  throw new Error('boom');
};

test('the wait grows by the factor and stops at the cap', () => {
  const rule = { baseMs: 100, factor: 2, capMs: 1000 };
  assert.equal(backoffDelay(rule, 3), 400);
  assert.equal(backoffDelay(rule, 10), 1000);
});

test('a job that always fails is dead after maxAttempts attempts', async () => {
  const clock = manualClock(0);
  const queue = createQueue({ clock, backoff: { baseMs: 10, factor: 1, capMs: 10 } });
  let calls = 0;
  queue.register('t', () => {
    calls += 1;
    failing();
  });
  const job = queue.enqueue('t', 1, { maxAttempts: 2 });
  for (let i = 0; i < 6; i += 1) {
    await queue.runDue();
    clock.advance(10);
  }
  assert.equal(calls, 2);
  assert.equal(queue.get(job.id).state, 'dead');
  assert.equal(queue.get(job.id).lastError, 'boom');
});

test('a job that fails once is retried and can still succeed', async () => {
  const clock = manualClock(0);
  const queue = createQueue({ clock, backoff: { baseMs: 10, factor: 2, capMs: 1000 } });
  let calls = 0;
  queue.register('t', () => {
    calls += 1;
    if (calls === 1) failing();
    return calls;
  });
  const job = queue.enqueue('t', 1);
  await queue.runDue();
  assert.equal(queue.get(job.id).state, 'queued');
  clock.advance(1000);
  await queue.runDue();
  assert.equal(queue.get(job.id).state, 'done');
  assert.equal(queue.get(job.id).attempts, 2);
});

test('an event tells about each retry', async () => {
  const clock = manualClock(0);
  const queue = createQueue({ clock });
  const retries = [];
  queue.on('retry', (event) => retries.push(event.job.attempts));
  queue.register('t', failing);
  queue.enqueue('t', 1);
  await queue.runDue();
  assert.deepEqual(retries, [1]);
});
