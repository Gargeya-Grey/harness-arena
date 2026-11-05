// Can a ranking be trusted? Error classes, the model check, clustered intervals,
// per-call folders, interleaved harnesses, heartbeat and resume. Fake harnesses
// only: no model calls, and every run goes to a temp copy of the fixture repo.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { resumeCommand, runCommand } from '../lab/commands/run.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { errorClass, modelCheck, normalizeErrorType, runLiveness } from '../lab/lib/checks.mjs';
import { readJson, readJsonl, writeJson } from '../lab/lib/fsutil.mjs';
import { bootstrapClustered, bootstrapMean } from '../lab/lib/metrics.mjs';
import { buildState } from '../lab/lib/state.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'repo');
const ANSWERS = { 'What is 2 + 2?': '4', 'What is the capital of France?': 'Paris', 'How many days are in a leap year?': '366' };
const questionOf = (prompt) => Object.keys(ANSWERS).find((question) => prompt.includes(question)) ?? prompt;
const answer = (prompt) => ANSWERS[questionOf(prompt)] ?? 'x';

function tempRoot(t, { agentic = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-validity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(FIXTURES, root, { recursive: true });
  if (agentic) {
    fs.cpSync(path.join(REPO, 'datasets', 'agentic'), path.join(root, 'datasets', 'agentic'), { recursive: true });
    fs.cpSync(path.join(REPO, 'prompts', 'agent-task'), path.join(root, 'prompts', 'agent-task'), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  return root;
}

/** A fake harness; `reply(question, ctx)` returns a result object or a string. */
function fake(t, name, reply, { version = () => '0.0.1' } = {}) {
  ADAPTERS[name] = {
    name,
    kind: 'cli',
    entrypoint: 'headless',
    access_method: 'subscription',
    supports_effort: false,
    edit: { args: [], note: 'fake' },
    detect: async () => ({ version: version() }),
    applied: () => ({}),
    async call(ctx) {
      const out = reply(ctx.messages.at(-1).content, ctx);
      const result = typeof out === 'string' ? { text: out } : out;
      return { finish_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 }, wall_ms: 5, events: [], ...result };
    },
  };
  t.after(() => delete ADAPTERS[name]);
}

function experiment(root, id, lines) {
  const file = path.join(root, 'experiments', `${id}.yaml`);
  fs.writeFileSync(file, [`id: ${id}`, 'suite: smoke', 'prompt: qa-single-turn', ...lines, 'evaluators:', '  - id: exact-match', '    version: "1"', '    dimension: quality', ''].join('\n'));
  return file;
}

const rowsOf = (runDir) => readJsonl(path.join(runDir, 'raw.jsonl')).rows;
const problemsOf = (root) => validateRepo(root).problems;

test('error classes: a usage limit or sign-in failure is lost, every other error is the configuration failing', () => {
  assert.equal(normalizeErrorType({ type: 'provider.chatgpt-limit', message: 'ChatGPT usage limit reached. Check ChatGPT Settings.' }), 'rate_limit');
  assert.equal(normalizeErrorType({ type: 'harness_error', message: 'API Error: 429 Too Many Requests' }), 'rate_limit');
  assert.equal(normalizeErrorType({ type: 'harness_error', message: 'Not logged in. Please log in.' }), 'auth');
  assert.equal(normalizeErrorType({ type: 'timeout', message: 'claude did not exit within 300 s' }), 'timeout');
  assert.equal(errorClass({ type: 'rate_limit', message: '' }), 'lost');
  assert.equal(errorClass({ type: 'not_installed', message: '' }), 'lost');
  assert.equal(errorClass({ type: 'timeout', message: '' }), 'failed');
  assert.equal(errorClass({ type: 'left_workdir', message: 'quota' }), 'failed');
  assert.equal(errorClass({ type: 'no_result', message: 'exited with code 1' }), 'failed');
  assert.equal(errorClass(null), null);
});

test('model check: a dated or listed id matches, another model does not, no report is unknown', () => {
  assert.equal(modelCheck('claude-haiku-5-5', 'claude-haiku-5-5-20261001'), 'match');
  assert.equal(modelCheck('google/gemini-3.8-flash', 'gemini-3.8-flash-lite, gemini-3.8-flash'), 'match');
  assert.equal(modelCheck('opencode/beam-free#high', 'opencode/beam-free'), 'match');
  assert.equal(modelCheck('claude-opus-5-5', 'claude-sonnet-5-5'), 'mismatch');
  assert.equal(modelCheck('claude-haiku-5-5', 'claude-haiku-5'), 'mismatch');
  assert.equal(modelCheck('gpt-6-luna', null), 'unknown');
});

test('clustered interval: three cases with three repeats are three tasks, not nine samples', () => {
  const groups = [[0, 0, 0], [1, 1, 1], [1, 1, 1]];
  assert.deepEqual(bootstrapClustered(groups, 'x'), [0, 1]);
  const naive = bootstrapMean(groups.flat(), 'x');
  assert.ok(naive[0] > 0, `the naive interval ${naive} treats repeats as independent`);
  assert.equal(bootstrapClustered([[1, 1]], 'x'), null, 'below 3 values');
  assert.deepEqual(bootstrapClustered([[1, 1, 1]], 'x'), [1, 1]);
});

test('a failed call scores 0 and a lost call leaves the score; the model check reaches the dashboard', async (t) => {
  const root = tempRoot(t);
  fake(t, 'fake-mixed', (question) => {
    if (question.includes('France')) return { error: { type: 'timeout', message: 'did not exit within 300 s' } };
    if (question.includes('leap')) return { error: { type: 'harness_error', message: 'Claude AI usage limit reached' } };
    return { text: answer(question), model_reported: 'someone-else-1' };
  });
  const file = experiment(root, 'mixed', ['repeats: 1', 'cases: [smoke-001, smoke-002, smoke-003]', 'harness: fake-mixed', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  const rows = rowsOf(result.runDir);
  assert.deepEqual(rows.map((row) => row.error?.type ?? null), [null, 'timeout', 'rate_limit']);
  assert.deepEqual(rows.map((row) => row.metadata.model_check), ['mismatch', 'unknown', 'unknown']);
  const state = buildState(root);
  const ctx = state.contexts.find((item) => item.runs.includes(result.runId));
  const agg = Object.values(ctx.aggregates)[0];
  // smoke-001 right (1), smoke-002 timed out (0), smoke-003 lost to the usage limit (left out).
  assert.equal(agg.mean_quality, 0.5);
  assert.equal(agg.answered_quality, 1);
  assert.equal(agg.counted_n, 2);
  assert.equal(agg.cases_n, 2);
  assert.equal(agg.failed_n, 1);
  assert.equal(agg.lost_n, 1);
  assert.equal(agg.pass_rate, 0.5);
  assert.equal(agg.model_mismatch_n, 1);
  assert.deepEqual(problemsOf(root), []);
});

test('every call gets its own temp folder, and the runner deletes it after the call', async (t) => {
  const root = tempRoot(t);
  const folders = [];
  fake(t, 'fake-cwd', (question, { cwd }) => {
    folders.push(cwd);
    fs.writeFileSync(path.join(cwd, 'solution.txt'), 'finished work');
    return answer(question);
  });
  const file = experiment(root, 'cwd', ['repeats: 2', 'cases: [smoke-001]', 'harness: fake-cwd', 'models: [claude-haiku, gpt-4o-mini]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  assert.equal(folders.length, 4);
  assert.equal(new Set(folders).size, 4, 'no two calls share a folder');
  for (const dir of folders) {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()), 'no sibling call folders under a shared run folder');
    assert.equal(fs.existsSync(dir), false, `${dir} was deleted`);
  }
  assert.deepEqual(rowsOf(result.runDir).map((row) => row.metadata.workdir_removed), [true, true, true, true]);
});

test('harnesses interleave: each case runs on every harness before the next case', async (t) => {
  const root = tempRoot(t);
  const order = [];
  fake(t, 'fake-a', (question) => (order.push(`a:${questionOf(question)}`), answer(question)));
  fake(t, 'fake-b', (question) => (order.push(`b:${questionOf(question)}`), answer(question)));
  const file = experiment(root, 'pair', ['repeats: 1', 'cases: [smoke-001, smoke-002]', 'targets:', '  - model: claude-haiku', '    harness: fake-a', '  - model: claude-haiku', '    harness: fake-b']);
  const results = await runCommand(root, file, { log: () => {} });
  assert.deepEqual(order, ['a:What is 2 + 2?', 'b:What is 2 + 2?', 'a:What is the capital of France?', 'b:What is the capital of France?']);
  assert.deepEqual(results.map((item) => item.status), ['completed', 'completed']);
});

test('a harness that updates itself during a run is recorded', async (t) => {
  const root = tempRoot(t);
  let detects = 0;
  fake(t, 'fake-update', (question) => answer(question), { version: () => (++detects === 1 ? '1.0.0' : '1.0.1') });
  const file = experiment(root, 'update', ['repeats: 1', 'cases: [smoke-001]', 'harness: fake-update', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  const manifest = readJson(path.join(result.runDir, 'run.json'));
  assert.equal(manifest.harness.version, '1.0.0');
  assert.equal(manifest.harness.settings.version_end, '1.0.1');
  assert.match(manifest.notes, /changed from 1\.0\.0 to 1\.0\.1/);
});

test('a crashed run shows as stale and resumes with only its missing rows', async (t) => {
  const root = tempRoot(t);
  let calls = 0;
  fake(t, 'fake-resume', (question) => (calls += 1, answer(question)));
  const file = experiment(root, 'resume', ['repeats: 2', 'cases: [smoke-001, smoke-002]', 'harness: fake-resume', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  assert.equal(calls, 4);
  // Make it look like the runner died after two rows.
  const rawFile = path.join(result.runDir, 'raw.jsonl');
  const kept = fs.readFileSync(rawFile, 'utf8').split('\n').slice(0, 2);
  fs.writeFileSync(rawFile, `${kept.join('\n')}\n`);
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
  const manifest = readJson(path.join(result.runDir, 'run.json'));
  writeJson(path.join(result.runDir, 'run.json'), { ...manifest, status: 'running', finished_at: null, runner: { pid: manifest.runner.pid, heartbeat_at: '2026-01-01T00:00:00.000Z' } });
  assert.equal(runLiveness(readJson(path.join(result.runDir, 'run.json'))), 'stale');
  const listed = buildState(root).runs.find((run) => run.run_id === result.runId);
  assert.equal(listed.liveness, 'stale');
  assert.equal(listed.resumable, true);

  const [resumed] = await resumeCommand(root, result.runId, { log: () => {} });
  assert.equal(calls, 6, 'only the two missing rows ran');
  const rows = rowsOf(result.runDir);
  assert.deepEqual(rows.map((row) => `${row.case_id} r${row.repeat}`), ['smoke-001 r0', 'smoke-002 r0', 'smoke-001 r1', 'smoke-002 r1']);
  const after = readJson(path.join(result.runDir, 'run.json'));
  assert.equal(resumed.status, 'completed');
  assert.equal(after.status, 'completed');
  assert.deepEqual(after.runner.resumes.map((item) => item.rows_before), [2]);
  assert.equal(readJsonl(path.join(result.runDir, 'scores', 'exact-match@1.jsonl')).rows.length, 4);
  assert.deepEqual(problemsOf(root), []);
  await assert.rejects(resumeCommand(root, result.runId, { log: () => {} }), /completed; nothing to resume/);
});

test('a resume is refused when the run is live or its suite changed', async (t) => {
  const root = tempRoot(t);
  fake(t, 'fake-refuse', (question) => answer(question));
  const file = experiment(root, 'refuse', ['repeats: 1', 'cases: [smoke-001]', 'harness: fake-refuse', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  const manifest = readJson(path.join(result.runDir, 'run.json'));
  writeJson(path.join(result.runDir, 'run.json'), { ...manifest, status: 'running', runner: { pid: process.pid, heartbeat_at: new Date().toISOString() } });
  await assert.rejects(resumeCommand(root, result.runId, { log: () => {} }), /still running/);
  writeJson(path.join(result.runDir, 'run.json'), { ...manifest, status: 'running', runner: { pid: process.pid, heartbeat_at: '2026-01-01T00:00:00.000Z' } });
  fs.appendFileSync(path.join(root, 'datasets', 'smoke', 'cases.jsonl'), '{"case_id":"smoke-new","input":{"question":"q"},"expected":"a"}\n');
  await assert.rejects(resumeCommand(root, result.runId, { log: () => {} }), /suite smoke changed/);
});

test('a run the user stops is marked interrupted and can be resumed', async (t) => {
  const root = tempRoot(t);
  let calls = 0;
  fake(t, 'fake-stop', (question) => {
    calls += 1;
    if (calls === 1) process.emit('SIGINT', 'SIGINT');
    return answer(question);
  });
  const file = experiment(root, 'stop', ['repeats: 1', 'cases: [smoke-001, smoke-002]', 'harness: fake-stop', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  const manifest = readJson(path.join(result.runDir, 'run.json'));
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.runner.interrupted, true);
  assert.equal(buildState(root).runs.find((run) => run.run_id === result.runId).resumable, true);
  await resumeCommand(root, result.runId, { log: () => {} });
  assert.equal(rowsOf(result.runDir).length, 2);
  assert.equal(readJson(path.join(result.runDir, 'run.json')).status, 'completed');
  assert.equal(readJson(path.join(result.runDir, 'run.json')).runner.interrupted, undefined);
});

test('a dashboard note, board or report written during an agent call does not halt the run', async (t) => {
  const root = tempRoot(t, { agentic: true });
  fake(t, 'fake-dash', (question, { cwd }) => {
    for (const dir of ['boards', 'annotations', 'reports']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, 'during-call.json'), '{}');
    }
    return 'done';
  });
  const file = path.join(root, 'experiments', 'dash.yaml');
  fs.writeFileSync(file, ['id: dash', 'suite: agentic', 'prompt: agent-task', 'repeats: 1', 'cases: [agentic-slugify-bug]', 'workdir: isolated', 'access: edit', 'harness: fake-dash', 'models: [claude-haiku]', 'evaluators:', '  - id: workspace-tests', '    version: "1"', '    dimension: quality', ''].join('\n'));
  const [result] = await runCommand(root, file, { log: () => {} });
  assert.equal(result.halted, false);
  assert.equal(rowsOf(result.runDir)[0].error, null);
});

test('new-case scaffolds an agent task that validate refuses until every marker is filled', async (t) => {
  const { newCase, FILL_IN } = await import('../lab/commands/new-case.mjs');
  const root = tempRoot(t, { agentic: true });
  const versionOf = () => /version:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(root, 'datasets', 'agentic', 'suite.yaml'), 'utf8'))[1];
  const old = versionOf();
  const written = newCase(root, 'agentic', 'ttl-cache', { log: () => {} });
  assert.deepEqual(written, [
    'datasets/agentic/cases.jsonl',
    'datasets/agentic/workspaces/ttl-cache/package.json',
    'datasets/agentic/workspaces/ttl-cache/src/ttl-cache.mjs',
    'datasets/agentic/checks/ttl-cache/probe.mjs',
    'datasets/agentic/checks/ttl-cache/expected.json',
  ]);
  const [major, minor, patch] = old.split('.').map(Number);
  assert.equal(versionOf(), `${major}.${minor}.${patch + 1}`);
  const line = readJsonl(path.join(root, 'datasets', 'agentic', 'cases.jsonl')).rows.at(-1);
  assert.deepEqual(line, { case_id: 'agentic-ttl-cache', input: { task: FILL_IN, workspace: 'ttl-cache' }, expected: { check: 'ttl-cache' }, tags: [] });
  const problems = problemsOf(root).filter((item) => item.includes(FILL_IN));
  assert.equal(problems.length, 5, problems.join('\n'));
  assert.throws(() => newCase(root, 'agentic', 'ttl-cache', { log: () => {} }), /already exists/);
  assert.throws(() => newCase(root, 'agentic', 'Bad Slug', { log: () => {} }), /lowercase/);
});
