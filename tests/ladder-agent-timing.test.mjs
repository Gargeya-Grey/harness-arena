import test from 'node:test';
import assert from 'node:assert/strict';
import { onlyTiming } from './ladder-agent-timing.mjs';

const failure = (want, got) => ({ error: `expected ${JSON.stringify(want)}, got ${got}` });
const object = { count: 3, fast: true, last: '/p' };
const rows = ['1000| a', '10000| b', '100000| c'];

test('a value that is right apart from its speed verdict is only timing', () => {
  assert.equal(onlyTiming(failure(object, '{"count":3,"fast":false,"last":"/p"}'), object), true);
  assert.equal(onlyTiming(failure(object, '{"slow":true}'), object), true);
});

test('rows that stop early with the speed marker are only timing', () => {
  assert.equal(onlyTiming(failure(rows, '["1000| a","10000| b","too slow"]'), rows), true);
  assert.equal(onlyTiming(failure(rows, '["1000| a","too slow"]'), rows), true);
  assert.equal(onlyTiming(failure(rows, '["1000| a","10000| b","100000| c","too slow"]'), rows), true);
});

test('a value cut by the evaluator is judged on the part that is kept', () => {
  assert.equal(onlyTiming(failure(object, '{"count":3,"fa'), object), true);
  assert.equal(onlyTiming(failure(rows, '["1000| a","100'), rows), true);
});

test('a wrong result, a thrown error or a spent budget is not timing', () => {
  assert.equal(onlyTiming(failure(object, '{"count":2,"fast":false,"last":"/p"}'), object), false);
  assert.equal(onlyTiming(failure(object, '{"count":3,"fast":true,"last":"/q"}'), object), false);
  assert.equal(onlyTiming(failure(rows, '["1000| x","too slow"]'), rows), false);
  assert.equal(onlyTiming(failure(rows, '["1000| a","10000| z","100000| c"]'), rows), false);
  assert.equal(onlyTiming({ error: 'boom' }, object), false);
  assert.equal(onlyTiming({ error: 'the CPU budget of 60000 ms for the check was spent before this probe' }, rows), false);
  assert.equal(onlyTiming({}, object), false);
});
