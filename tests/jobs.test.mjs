// Jobs API: the dashboard starts allowlisted `node lab` commands. These tests use a
// disposable data root (fixture runs + the real experiments) and make no model calls.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../dashboard/server.mjs';
import { buildArgs, catalog } from '../dashboard/jobs.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let root;
let server;
let port;
let fakeServer;
let fakePort;

function request(p, method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: p, method, path: url, headers: { host: `127.0.0.1:${p}`, 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitForEnd(p, id, ms = 60000) {
  const until = Date.now() + ms;
  for (;;) {
    const res = await request(p, 'GET', `/api/jobs/${id}`);
    if (!['running', 'stopping'].includes(res.json.job.status)) return res.json;
    if (Date.now() > until) throw new Error(`job ${id} still ${res.json.job.status}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test.before(async () => {
  root = execFileSync(process.execPath, [path.join(REPO, '.agents/skills/verify-model-lab/scripts/temp-root.mjs')], { encoding: 'utf8' }).trim();
  server = createServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  // A stand-in CLI that never ends by itself: it prints what reaches its stdin.
  const fake = path.join(root, 'fake-cli.mjs');
  fs.writeFileSync(fake, "console.log('started');\nprocess.stdin.on('data', (d) => console.log('stdin ' + String(d).trim()));\nsetInterval(() => {}, 1000);\n");
  fakeServer = createServer({ root, jobOptions: { cliPath: fake } });
  await new Promise((resolve) => fakeServer.listen(0, '127.0.0.1', resolve));
  fakePort = fakeServer.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => fakeServer.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 300));
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

test('buildArgs allows only the listed commands and checked arguments', () => {
  const exp = path.join(root, 'experiments', 'smoke-opencode.yaml');
  assert.deepEqual(buildArgs(root, { command: 'run', experiment: 'smoke-opencode.yaml', harness: 'opencode', models: ['a', 'b'], cases: 'smoke-001, smoke-002', repeats: 2, dry_run: true }), [
    'run', exp, '--harness', 'opencode', '--models', 'a,b', '--cases', 'smoke-001,smoke-002', '--repeats', '2', '--dry-run',
  ]);
  assert.deepEqual(buildArgs(root, { command: 'validate', experiment: 'ignored' }), ['validate']);
  assert.deepEqual(buildArgs(root, { command: 'score', all: true, force: true }), ['score', '--all', '--force']);
  const refused = [
    { command: 'dashboard' },
    { command: 'run; rm -rf /' },
    { command: 'run', experiment: '../configs/models.yaml' },
    { command: 'run', experiment: path.join(root, 'experiments', 'smoke-opencode.yaml') },
    { command: 'run', experiment: 'missing.yaml' },
    { command: 'run', experiment: 'smoke-opencode.yaml', models: ['--dry-run'] },
    { command: 'run', experiment: 'smoke-opencode.yaml', cases: ['-x'] },
    { command: 'run', experiment: 'smoke-opencode.yaml', harness: '--force' },
    { command: 'run', experiment: 'smoke-opencode.yaml', repeats: 0 },
    { command: 'run', experiment: 'smoke-opencode.yaml', repeats: 1.5 },
    { command: 'score' },
    { command: 'score', run_ids: ['../x'] },
    { command: 'score', run_ids: ['no-such-run'] },
  ];
  for (const body of refused) assert.throws(() => buildArgs(root, body), (error) => error.status === 400, JSON.stringify(body));
});

test('catalog lists experiments with targets and suite case ids, plus harnesses and model keys', () => {
  const cat = catalog(root);
  const exp = cat.experiments.find((item) => item.file === 'opencode-agentic.yaml');
  assert.equal(exp.suite, 'agentic');
  assert.equal(exp.access, 'edit');
  assert.ok(exp.targets.some((t) => t.model === 'pulse-alpha-free' && t.harness === 'opencode'));
  assert.ok(exp.case_ids.includes('agentic-slugify-bug'));
  assert.ok(cat.harnesses.some((h) => h.name === 'opencode'));
  assert.ok(cat.models.includes('pulse-alpha-free'));
  // The older format (one harness, a models list) gives the same target shape.
  const legacy = cat.experiments.find((item) => item.file === 'smoke-command-code.yaml');
  assert.deepEqual(legacy.targets, [{ model: 'deepseek-v4.1-flash-max', harness: 'command-code' }]);
  assert.deepEqual(legacy.problems, []);
});

test('a validate job runs the real CLI on the data root and reports its output', async () => {
  const res = await request(port, 'POST', '/api/jobs', { body: { command: 'validate' } });
  assert.equal(res.status, 202);
  assert.deepEqual(res.json.job.args, ['node', 'lab', 'validate']);
  const end = await waitForEnd(port, res.json.job.id);
  assert.equal(end.job.status, 'passed', end.lines.join('\n'));
  assert.ok(end.lines.some((line) => /All inputs and records are valid/.test(line)), end.lines.join('\n'));
  const later = await request(port, 'GET', `/api/jobs/${res.json.job.id}?since=${end.job.lines}`);
  assert.deepEqual(later.json.lines, []);
});

test('a dry-run job shows the plan, calls nothing and writes no run', async () => {
  const before = fs.readdirSync(path.join(root, 'results')).length;
  const res = await request(port, 'POST', '/api/jobs', { body: { command: 'run', experiment: 'opencode-agentic.yaml', cases: ['agentic-slugify-bug'], repeats: 1, dry_run: true } });
  assert.equal(res.status, 202);
  assert.equal(res.json.job.args[3], 'experiments/opencode-agentic.yaml');
  const end = await waitForEnd(port, res.json.job.id);
  assert.equal(end.job.status, 'passed', end.lines.join('\n'));
  assert.ok(end.lines.some((line) => line.includes('Dry run: nothing was called or written.')));
  assert.equal(fs.readdirSync(path.join(root, 'results')).length, before);
});

test('one job at a time; the first stop of a run asks on stdin, the second ends the process', async () => {
  const first = await request(fakePort, 'POST', '/api/jobs', { body: { command: 'run', experiment: 'smoke-opencode.yaml', dry_run: true } });
  assert.equal(first.status, 202);
  const busy = await request(fakePort, 'POST', '/api/jobs', { body: { command: 'validate' } });
  assert.equal(busy.status, 409);
  assert.equal(busy.json.job.id, first.json.job.id);
  const id = first.json.job.id;
  for (let i = 0; i < 50 && !(await request(fakePort, 'GET', `/api/jobs/${id}`)).json.lines.includes('started'); i += 1) await new Promise((r) => setTimeout(r, 100));
  const stop1 = await request(fakePort, 'POST', `/api/jobs/${id}/cancel`, { body: {} });
  assert.equal(stop1.json.job.status, 'stopping');
  for (let i = 0; i < 50 && !(await request(fakePort, 'GET', `/api/jobs/${id}`)).json.lines.includes('stdin cancel'); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.ok((await request(fakePort, 'GET', `/api/jobs/${id}`)).json.lines.includes('stdin cancel'));
  await request(fakePort, 'POST', `/api/jobs/${id}/cancel`, { body: {} });
  const end = await waitForEnd(fakePort, id, 15000);
  assert.equal(end.job.status, 'stopped');
  const list = await request(fakePort, 'GET', '/api/jobs');
  assert.equal(list.json.running, null);
});

test('job writes need a local Origin; unknown jobs are 404', async () => {
  const cross = await request(port, 'POST', '/api/jobs', { body: { command: 'validate' }, headers: { origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  const plain = await request(port, 'POST', '/api/jobs', { body: { command: 'validate' }, headers: { 'content-type': 'text/plain' } });
  assert.equal(plain.status, 415);
  assert.equal((await request(port, 'GET', '/api/jobs/nope')).status, 404);
  assert.equal((await request(port, 'POST', '/api/jobs/nope/cancel', { body: {} })).status, 404);
  assert.equal((await request(port, 'POST', '/api/jobs', { body: { command: 'dashboard' } })).status, 400);
});

test('under LAB_JOB the CLI still exits on its own while stdin stays open', async () => {
  const child = spawn(process.execPath, [path.join(REPO, 'lab', 'cli.mjs'), 'runs'], { env: { ...process.env, LAB_ROOT: root, LAB_JOB: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the CLI waited on stdin')), 20000);
    child.on('close', (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  assert.equal(code, 0);
});
