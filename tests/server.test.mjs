// Dashboard server on an ephemeral port, over a copy of the fixture repo so
// that writes (annotations, boards) never touch tracked files.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from '../dashboard/server.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');
let root;
let server;
let port;

function request(method, url, { body, host, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { host: host || `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          // Not JSON: static file or plain text.
        }
        resolve({ status: res.statusCode, headers: res.headers, text: data, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

test.before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-server-'));
  fs.cpSync(FIXTURES, root, { recursive: true });
  server = createServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

test('health and state', async () => {
  assert.equal((await request('GET', '/api/health')).json.ok, true);
  const state = (await request('GET', '/api/state')).json;
  assert.equal(state.contexts.length, 5);
  assert.equal(state.observations.length, 123);
  assert.equal(state.ladder.suites.find((suite) => suite.id === 'ladder-answer').cases.length, 12, 'the state carries the ladder, unrun cases included');
});

test('only local Host headers are served', async () => {
  assert.equal((await request('GET', '/api/health', { host: 'evil.example' })).status, 403);
  assert.equal((await request('GET', '/api/health', { host: 'localhost:1234' })).status, 200);
});

test('static files carry a strict CSP; traversal and bad escapes are 404', async () => {
  const index = await request('GET', '/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-security-policy'], /default-src 'self'/);
  assert.equal((await request('GET', '/..%2f..%2fpackage.json')).status, 404);
  assert.equal((await request('GET', '/%E0%A4%A')).status, 404);
  assert.equal((await request('GET', '/api/nope')).status, 404);
});

test('artifacts: served inside their run only, SVG with a no-script CSP', async () => {
  const state = (await request('GET', '/api/state')).json;
  const isFile = (artifact) => artifact.available && artifact.path && artifact.mime === 'image/svg+xml';
  const observation = state.observations.find((item) => item.artifacts?.some(isFile));
  assert.ok(observation, 'the fixture has an SVG artifact');
  const artifact = observation.artifacts.find(isFile);
  const ok = await request('GET', `/api/artifact?run_id=${encodeURIComponent(observation.run_id)}&path=${encodeURIComponent(artifact.path)}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-security-policy'], /script-src 'none'|default-src 'none'/);
  const escape = await request('GET', `/api/artifact?run_id=${encodeURIComponent(observation.run_id)}&path=${encodeURIComponent('../../configs/models.yaml')}`);
  assert.equal(escape.status, 404);
});

test('annotations: validated, then appended', async () => {
  const state = (await request('GET', '/api/state')).json;
  const target = state.observations.find((item) => item.status === 'ok');
  assert.equal((await request('POST', '/api/annotations', { body: { run_id: target.run_id } })).status, 400);
  assert.equal((await request('POST', '/api/annotations', { body: '{bad' })).status, 400);
  const created = await request('POST', '/api/annotations', {
    body: { run_id: target.run_id, case_id: target.case_id, config_id: target.config_id, repeat: target.repeat, value: 4, notes: 'clear' },
  });
  assert.equal(created.status, 201, created.text);
  const file = path.join(root, 'annotations', 'human@1.jsonl');
  assert.ok(fs.readFileSync(file, 'utf8').includes(created.json.annotation_id));
});

test('boards: save keeps created_at, delete removes the file', async () => {
  const state = (await request('GET', '/api/state')).json;
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'boards', 'haiku-harness.json'), 'utf8'));
  const body = { board_id: 'test-board', title: 'Test board', context: saved.context, treatment_axis: 'harness', configs: saved.configs };
  const first = await request('POST', '/api/boards', { body });
  assert.equal(first.status, 201, first.text);
  const second = await request('POST', '/api/boards', { body: { ...body, title: 'Renamed' } });
  assert.equal(second.json.created_at, first.json.created_at);
  assert.equal((await request('DELETE', '/api/boards/test-board')).status, 200);
  assert.equal((await request('DELETE', '/api/boards/test-board')).status, 404);
});

test('writes need a JSON content type and a local Origin, so another site cannot post', async () => {
  const board = { title: 'csrf', context: {}, configs: [] };
  const plain = await request('POST', '/api/boards', { body: board, headers: { 'content-type': 'text/plain' } });
  assert.equal(plain.status, 415);
  const foreign = await request('POST', '/api/annotations', { body: { value: 3 }, headers: { origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  const del = await request('DELETE', '/api/boards/anything', { headers: { origin: 'https://evil.example' } });
  assert.equal(del.status, 403);
  const local = await request('POST', '/api/boards', { body: { title: 'local origin', ...boardBase() }, headers: { origin: 'http://127.0.0.1:' + port } });
  assert.equal(local.status, 201, local.text);
});

test('a JSON body that is not an object is a 400, not a 500', async () => {
  for (const body of ['null', '[]', '3']) {
    assert.equal((await request('POST', '/api/boards', { body })).status, 400, body);
    assert.equal((await request('POST', '/api/annotations', { body })).status, 400, body);
  }
});

test('a new board never replaces another board whose title maps to the same id', async () => {
  const save = (title) => request('POST', '/api/boards', { body: { title, ...boardBase() } });
  const ids = [];
  for (const title of ['Run A/B', 'Run A B', '評価', 'テスト']) {
    const res = await save(title);
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.title, title);
    ids.push(res.json.board_id);
  }
  assert.equal(new Set(ids).size, 4, ids.join(', '));
  for (const id of ids) assert.ok(fs.existsSync(path.join(root, 'boards', id + '.json')), id);
});

test('notes with multibyte text survive a body split across chunks', async () => {
  // Two lengths, so a two-byte character lands across the 64 KiB chunk edge in one of them.
  for (const pad of ['', 'x']) {
    const notes = pad + 'é'.repeat(40000) + '評価';
    const res = await request('POST', '/api/annotations', { body: { run_id: 'r', case_id: 'c', config_id: 'x', repeat: 0, value: 4, notes } });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.notes, notes);
  }
});

function boardBase() {
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'boards', 'haiku-harness.json'), 'utf8'));
  return { context: saved.context, treatment_axis: saved.treatment_axis, configs: saved.configs };
}
