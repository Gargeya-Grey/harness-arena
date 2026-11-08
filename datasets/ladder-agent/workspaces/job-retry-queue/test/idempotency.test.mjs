import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, manualClock } from '../src/index.mjs';

test('the same key while the job waits gives the same job', () => {
  const queue = createQueue({ clock: manualClock(0) });
  const a = queue.enqueue('mail', { n: 1 }, { key: 'k1' });
  const b = queue.enqueue('mail', { n: 2 }, { key: 'k1' });
  assert.equal(a.id, b.id);
  assert.deepEqual(b.payload, { n: 1 });
});

test('a job without a key is never a duplicate', () => {
  const queue = createQueue({ clock: manualClock(0) });
  assert.notEqual(queue.enqueue('mail', 1).id, queue.enqueue('mail', 1).id);
});

test('a queued job can be cancelled', () => {
  const queue = createQueue({ clock: manualClock(0) });
  const job = queue.enqueue('mail', 1);
  assert.equal(queue.cancel(job.id), true);
  assert.equal(queue.cancel('nope'), false);
  assert.equal(queue.get(job.id).state, 'cancelled');
});

test('stats count what happened', async () => {
  const queue = createQueue({ clock: manualClock(0) });
  queue.register('mail', () => {});
  queue.enqueue('mail', 1);
  await queue.runDue();
  assert.equal(queue.stats().completed, 1);
});
