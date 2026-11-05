import test from 'node:test';
import assert from 'node:assert/strict';
import { finishedJobs } from '../dashboard/public/js/jobwatch.js';

const ids = (list) => list.map((j) => j.id);

test('first poll reports nothing', () => {
  assert.deepEqual(finishedJobs(null, [{ id: 'a', status: 'passed' }]), []);
});

test('a running job that ends is reported once', () => {
  const before = new Map([['a', 'running']]);
  assert.deepEqual(ids(finishedJobs(before, [{ id: 'a', status: 'passed' }])), ['a']);
  const after = new Map([['a', 'passed']]);
  assert.deepEqual(finishedJobs(after, [{ id: 'a', status: 'passed' }]), []);
});

test('a job that starts and ends between two polls is reported', () => {
  const before = new Map([['a', 'passed']]);
  const jobs = [{ id: 'b', status: 'passed' }, { id: 'a', status: 'passed' }];
  assert.deepEqual(ids(finishedJobs(before, jobs)), ['b']);
});

test('running to stopping is not an end', () => {
  const before = new Map([['a', 'running']]);
  assert.deepEqual(finishedJobs(before, [{ id: 'a', status: 'stopping' }]), []);
  const later = new Map([['a', 'stopping']]);
  assert.deepEqual(ids(finishedJobs(later, [{ id: 'a', status: 'stopped' }])), ['a']);
});

test('a new job that is still running is not reported', () => {
  assert.deepEqual(finishedJobs(new Map(), [{ id: 'c', status: 'running' }]), []);
});
