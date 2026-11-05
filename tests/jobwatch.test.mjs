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

test('run progress reads the plan, the run ids and each call, errors included', async () => {
  const { runProgress, emptyProgress, jobName, jobTitle } = await import('../dashboard/public/js/jobwatch.js');
  const lines = [
    'Experiment agentic: suite agentic 1.0.0, prompt agent-task v1, 18 call(s) across 1 harness(es)',
    '  opencode: beam-free → model "opencode/beam", effort default, user setup loaded',
    '',
    '20261105T060204Z__agentic__opencode-agentic__a4a7c9',
    '  harness opencode 1.2.3 · 2 model(s) · 3 case(s) · 3 repeat(s) · workdir isolated',
    '  agentic-slugify-bug r0 beam-free: "Fixed the slug · and tests" · 21651 ms · 64017 in / 971 out',
    '  agentic-csv-quotes r0 pulse-free: ERROR timeout: no answer in 600 s · ? ms · ? in / ? out',
  ];
  const first = runProgress(lines.slice(0, 6));
  assert.deepEqual(first, { total: 18, done: 1, errors: 0, current: 'agentic-slugify-bug', runIds: ['20261105T060204Z__agentic__opencode-agentic__a4a7c9'] });
  const next = runProgress(lines.slice(6), first);
  assert.deepEqual(next, { total: 18, done: 2, errors: 1, current: 'agentic-csv-quotes', runIds: ['20261105T060204Z__agentic__opencode-agentic__a4a7c9'] });
  assert.deepEqual(first.runIds.length, 1, 'the earlier progress is not changed');
  assert.deepEqual(runProgress(['  agentic-x r0 beam-free: workspace not stored: EBUSY']), emptyProgress());
  assert.equal(jobName({ command: 'run', label: 'run experiments/agentic.yaml --repeats 1' }), 'agentic run');
  assert.equal(jobName({ command: 'run', dry_run: true, label: 'run experiments/smoke.yml --dry-run' }), 'smoke preview');
  assert.equal(jobName({ command: 'doctor', label: 'doctor' }), 'harness check');
  assert.equal(jobTitle({ command: 'run', dry_run: true, label: 'run experiments/agentic-sweep.yaml --dry-run' }), 'Preview of agentic-sweep');
  assert.equal(jobTitle({ command: 'run', label: 'run experiments/agentic-sweep.yaml' }), 'Run of agentic-sweep');
  assert.equal(jobTitle({ command: 'score', label: 'score --all' }), 'Scoring');
});
