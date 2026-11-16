import test from 'node:test';
import assert from 'node:assert/strict';
import { SlaError, computeSla, createCalendar } from '../src/index.mjs';

const HOUR = 3_600_000;
const at = (text) => Date.parse(`${text}Z`);
const office = createCalendar({ week: Object.fromEntries([1, 2, 3, 4, 5].map((day) => [day, [['09:00', '17:00']]])) });

test('a running clock counts open time', () => {
  const result = computeSla({ calendar: office, target: 4 * HOUR, events: [{ type: 'start', at: at('2024-03-04T09:00:00') }], now: at('2024-03-04T11:00:00') });
  assert.equal(result.state, 'running');
  assert.equal(result.elapsed, 2 * HOUR);
  assert.equal(result.remaining, 2 * HOUR);
  assert.equal(result.deadline, at('2024-03-04T13:00:00'));
});

test('a pause stops the clock', () => {
  const events = [
    { type: 'start', at: at('2024-03-04T09:00:00') },
    { type: 'pause', at: at('2024-03-04T10:00:00') },
    { type: 'resume', at: at('2024-03-04T15:00:00') },
  ];
  const result = computeSla({ calendar: office, target: 4 * HOUR, events, now: at('2024-03-04T16:00:00') });
  assert.equal(result.elapsed, 2 * HOUR);
});

test('a paused clock has no deadline yet', () => {
  const events = [{ type: 'start', at: at('2024-03-04T09:00:00') }, { type: 'pause', at: at('2024-03-04T10:00:00') }];
  assert.equal(computeSla({ calendar: office, target: 4 * HOUR, events, now: at('2024-03-05T10:00:00') }).deadline, null);
});

test('a history must start with a start event', () => {
  assert.throws(() => computeSla({ calendar: office, target: HOUR, events: [{ type: 'pause', at: 0 }], now: 1 }), SlaError);
});

test('a ticket is breached when more time passed than the target', () => {
  const events = [{ type: 'start', at: at('2024-03-04T09:00:00') }, { type: 'stop', at: at('2024-03-04T14:00:00') }];
  const result = computeSla({ calendar: office, target: 4 * HOUR, events, now: at('2024-03-06T09:00:00') });
  assert.equal(result.breached, true);
  assert.equal(result.state, 'stopped');
});
