import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../dashboard/server.mjs';

const fixture = fileURLToPath(new URL('./fixtures/repo', import.meta.url));

test('the dashboard prepares an exact rerun and deliberately deletes history without changing tests', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-history-api-'));
  fs.cpSync(fixture, root, { recursive: true });
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  fs.writeFileSync(path.join(root, 'configs/models.yaml'), 'models:\n  toy:\n    provider: openai\n    model: toy-snapshot\n    effort_levels: [low, high]\n    params: {}\n');
  fs.writeFileSync(path.join(root, 'experiments/history.yaml'), 'id: history\nsuite: smoke\nprompt: qa-single-turn\nprompt_version: "1"\neffort_policy: explicit\ntargets:\n  - model: toy\n    harness: codex\n    effort: high\nrepeats: 1\nevaluators:\n  - id: exact-match\n    version: "1"\n');
  const sourceId = 'synthetic-rerun-source';
  fs.mkdirSync(path.join(root, 'results', sourceId));
  fs.writeFileSync(path.join(root, 'results', sourceId, 'run.json'), JSON.stringify({ run_id: sourceId, status: 'completed', experiment: { id: 'history', cases: ['smoke-001'] }, suite: { id: 'smoke', version: '1.0.0' }, harness: { name: 'codex', version: 'test' }, models: [{ model_key: 'toy', reasoning_effort: 'low' }], repeats: 2 }));
  const testsBefore = fs.readFileSync(path.join(root, 'datasets/smoke/cases.jsonl'));
  const server = createServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body, headers = {}) => {
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const library = (await request('/api/catalog')).body;
    const smoke = library.suites.find(suite => suite.id === 'smoke');
    assert.equal(smoke.case_count, testsBefore.toString('utf8').trim().split('\n').length);
    assert(smoke.cases.every(item => item.task && !('expected' in item)));
    const before = (await request('/api/storage')).body;
    assert(before.run_count > 1);
    const rerun = await request('/api/rerun?run_id=' + sourceId);
    assert.equal(rerun.status, 200);
    assert.deepEqual(rerun.body.selection, { experiment: 'history.yaml', harness: 'codex', models: ['toy'], cases: ['smoke-001'], repeats: 2, effort: 'low' });
    assert.equal((await request('/api/jobs')).body.jobs.length, 0, 'rerun prepares a selection without starting a job');
    assert.equal((await request('/api/storage')).body.run_count, before.run_count);
    assert.equal((await request('/api/rerun?run_id=missing')).status, 404);
    assert.equal((await request('/api/storage/delete', { run_id: sourceId, confirm: 'wrong' })).status, 400);
    assert.equal((await request('/api/storage/delete', { run_id: '../escape', confirm: '../escape' })).status, 400);
    assert.equal((await request('/api/storage/delete', { run_id: sourceId, confirm: sourceId }, { Origin: 'https://elsewhere.invalid' })).status, 403);
    const deleted = await request('/api/storage/delete', { run_id: sourceId, confirm: sourceId });
    assert.equal(deleted.status, 200);
    assert(deleted.body.bytes_deleted > 0);
    assert.equal((await request('/api/storage')).body.run_count, before.run_count - 1);
    assert((await request('/api/state')).body.observations.length > 0, 'other trusted runs still count');
    assert.equal((await request('/api/storage/reset', { confirm: 'yes' })).status, 400);
    const reset = await request('/api/storage/reset', { confirm: 'DELETE ALL RUNS' });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.run_count, before.run_count - 1);
    assert.equal((await request('/api/storage')).body.run_count, 0);
    const state = (await request('/api/state')).body;
    assert.equal(state.runs.length, 0);
    assert.equal(state.observations.length, 0);
    assert.equal(fs.readFileSync(path.join(root, 'lab.ledger.jsonl'), 'utf8'), '');
    assert.deepEqual(fs.readFileSync(path.join(root, 'datasets/smoke/cases.jsonl')), testsBefore);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('history mutations refuse a running dashboard job and a reset clears finished job history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-history-busy-'));
  fs.cpSync(fixture, root, { recursive: true });
  const cliPath = path.join(root, 'stand-in-cli.mjs');
  fs.writeFileSync(cliPath, 'console.log("ready"); setInterval(() => {}, 1000);\n');
  const server = createServer({ root, jobOptions: { cliPath } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const started = await (await post('/api/jobs', { command: 'validate' })).json();
    assert.equal((await post('/api/storage/reset', { confirm: 'DELETE ALL RUNS' })).status, 409);
    await post(`/api/jobs/${started.job.id}/cancel`, {});
    await server.jobs.shutdown({ now: true });
    assert.equal(server.jobs.list().jobs.length, 1);
    assert.equal((await post('/api/storage/reset', { confirm: 'DELETE ALL RUNS' })).status, 200);
    assert.deepEqual(server.jobs.list(), { jobs: [], running: null });
  } finally {
    await server.jobs.shutdown({ now: true });
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
