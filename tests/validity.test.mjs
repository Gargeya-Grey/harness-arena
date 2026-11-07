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
import { scoreRun } from '../lab/commands/score.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { errorClass, modelCheck, normalizeErrorType, runLiveness } from '../lab/lib/checks.mjs';
import { readJson, readJsonl, writeJson } from '../lab/lib/fsutil.mjs';
import { bootstrapClustered, bootstrapMean, clusteredInterval } from '../lab/lib/metrics.mjs';
import { buildState } from '../lab/lib/state.mjs';
import { crashInLedger } from './crash.mjs';
import { appendEntry, ledgerPath } from '../lab/lib/ledger.mjs';

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
    fs.cpSync(path.join(REPO, 'datasets', 'archive', 'agentic'), path.join(root, 'datasets', 'agentic'), { recursive: true });
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
  // Free text from stderr: a stack line or a path is not a limit or a sign-in failure.
  assert.equal(normalizeErrorType({ type: 'no_result', message: 'at Object.<anonymous> (cli.js:429:15)' }), 'no_result');
  assert.equal(normalizeErrorType({ type: 'harness_error', message: 'GET /auth/token failed in some-auth' }), 'harness_error');
  assert.equal(normalizeErrorType({ type: 'harness_error', message: 'status 401 from the API' }), 'auth');
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
  assert.equal(modelCheck('gemini-3.8-flash', 'gemini-3.8-flash-lite'), 'mismatch', 'a smaller sibling model is a swap');
  assert.equal(modelCheck('gpt-6-luna', 'gpt-6-luna-mini'), 'mismatch');
  assert.equal(modelCheck('gpt-6-luna', 'gpt-6-luna-latest'), 'match');
  assert.equal(modelCheck('gpt-6-luna', null), 'unknown');
});

test('clustered interval: three cases with three repeats are three tasks, not nine samples', () => {
  const groups = [[0, 0, 0], [1, 1, 1], [1, 1, 1]];
  assert.deepEqual(bootstrapClustered(groups, 'x'), [0, 1]);
  const naive = bootstrapMean(groups.flat(), 'x');
  assert.ok(naive[0] > 0, `the naive interval ${naive} treats repeats as independent`);
  assert.equal(bootstrapClustered([[1, 1, 1]], 'x'), null, 'one case with repeats says nothing across cases');
  assert.equal(bootstrapClustered([[1], [1]], 'x'), null, 'below 3 cases');
  // Every case passing collapses the bootstrap to [1, 1]; the shown interval does not.
  assert.deepEqual(bootstrapClustered([[1, 1], [1, 1], [1, 1]], 'x'), [1, 1]);
  const shown = clusteredInterval([[1, 1], [1, 1], [1, 1]], 'x');
  assert.equal(shown[1], 1);
  assert.ok(shown[0] > 0.4 && shown[0] < 0.5, `three passing cases give [${shown}]`);
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
  crashInLedger(root, result.runId, 2);
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
  const written = newCase(root, 'agentic', 'scaffold-only-test', { log: () => {} });
  assert.deepEqual(written, [
    'datasets/agentic/cases.jsonl',
    'datasets/agentic/workspaces/scaffold-only-test/package.json',
    'datasets/agentic/workspaces/scaffold-only-test/src/scaffold-only-test.mjs',
    'datasets/agentic/checks/scaffold-only-test/probe.mjs',
    'datasets/agentic/checks/scaffold-only-test/expected.json',
  ]);
  const [major, minor, patch] = old.split('.').map(Number);
  assert.equal(versionOf(), `${major}.${minor}.${patch + 1}`);
  const line = readJsonl(path.join(root, 'datasets', 'agentic', 'cases.jsonl')).rows.at(-1);
  assert.deepEqual(line, { case_id: 'agentic-scaffold-only-test', input: { task: FILL_IN, workspace: 'scaffold-only-test' }, expected: { check: 'scaffold-only-test' }, tags: [] });
  const problems = problemsOf(root).filter((item) => item.includes(FILL_IN));
  assert.equal(problems.length, 5, problems.join('\n'));
  assert.throws(() => newCase(root, 'agentic', 'scaffold-only-test', { log: () => {} }), /already exists/);
  assert.throws(() => newCase(root, 'agentic', 'Bad Slug', { log: () => {} }), /lowercase/);
});

test('a run waiting its turn stays live: liveness follows the process, not only the heartbeat', () => {
  const hourOld = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayOld = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const running = (heartbeat_at) => ({ status: 'running', harness: { settings: { timeout_s: 900 } }, runner: { pid: 1234, heartbeat_at } });
  assert.equal(runLiveness(running(hourOld), Date.now(), () => true), 'live');
  assert.equal(runLiveness(running(hourOld), Date.now(), () => false), 'stale');
  assert.equal(runLiveness(running(dayOld), Date.now(), () => true), 'stale', 'the process id is someone else by then');
  assert.equal(runLiveness({ status: 'running' }), 'unknown');
  assert.equal(runLiveness({ status: 'completed' }), null);
});

test('every open run beats before each call, so the waiting harness never looks stale', async (t) => {
  const root = tempRoot(t);
  const seen = [];
  const read = () => fs.readdirSync(path.join(root, 'results')).filter((name) => name.includes('__beat__')).map((name) => readJson(path.join(root, 'results', name, 'run.json')).runner.heartbeat_at);
  fake(t, 'fake-p', (question) => (seen.push(read()), answer(question)));
  fake(t, 'fake-q', (question) => (seen.push(read()), answer(question)));
  const file = experiment(root, 'beat', ['repeats: 1', 'cases: [smoke-001, smoke-002]', 'targets:', '  - model: claude-haiku', '    harness: fake-p', '  - model: claude-haiku', '    harness: fake-q']);
  await runCommand(root, file, { log: () => {} });
  assert.equal(seen.length, 4);
  // One beat writes every open run just before each call: both runs show the same moment.
  for (const beat of seen) assert.deepEqual(beat, [beat[0], beat[0]], `both runs beat together: ${beat}`);
});

test('errors of a halted or unscored run do not count as 0', async (t) => {
  const root = tempRoot(t);
  fake(t, 'fake-halt', (question) => (question.includes('France') ? { error: { type: 'timeout', message: 'did not exit' } } : answer(question)));
  const file = experiment(root, 'halt', ['repeats: 1', 'cases: [smoke-001, smoke-002]', 'harness: fake-halt', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  const manifest = readJson(path.join(result.runDir, 'run.json'));
  writeJson(path.join(result.runDir, 'run.json'), { ...manifest, harness: { ...manifest.harness, settings: { ...manifest.harness.settings, halted: 'left_workdir' } } });
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
  // A real halt also writes a halt entry to the evidence ledger.
  appendEntry(ledgerPath(root), { kind: 'halt', run_id: result.runId, reason: 'left_workdir' });
  // All or nothing: a halted run is listed, and counts in no aggregate.
  const state = buildState(root);
  assert.equal(state.runs.find((run) => run.run_id === result.runId).trust.state, 'halted');
  const halted = Object.values(state.contexts.find((item) => item.runs.includes(result.runId)).aggregates)[0];
  assert.equal(halted.counted_n, 0);
  assert.equal(halted.failed_n, 0);
  assert.equal(halted.mean_quality, null);
  // A run with evaluators and no recorded scores counts nowhere, its error included.
  const [plain] = await runCommand(root, experiment(root, 'unscored', ['repeats: 1', 'cases: [smoke-001, smoke-002]', 'harness: fake-halt', 'models: [claude-haiku]']), { log: () => {} });
  fs.rmSync(path.join(plain.runDir, 'scores'), { recursive: true, force: true });
  appendEntry(ledgerPath(root), { kind: 'scores', run_id: plain.runId, files: {} });
  const agg = Object.values(buildState(root).contexts.find((item) => item.runs.includes(plain.runId)).aggregates)[0];
  assert.equal(agg.counted_n, 0);
  assert.equal(agg.mean_quality, null, 'no 0.00 from errors alone');
  assert.equal(agg.failed_n, 0);
  // Scored, the run counts, and its error shows with no 0.00 of its own.
  scoreRun(root, plain.runDir, { log: () => {} });
  const scored = Object.values(buildState(root).contexts.find((item) => item.runs.includes(plain.runId)).aggregates)[0];
  assert.equal(scored.failed_n, 1, 'the error shows once the run is scored');
});

test('resume --dry-run calls nothing; a torn last line is dropped and recorded', async (t) => {
  const root = tempRoot(t);
  let calls = 0;
  fake(t, 'fake-torn', (question) => (calls += 1, answer(question)));
  const file = experiment(root, 'torn', ['repeats: 1', 'cases: [smoke-001, smoke-002, smoke-003]', 'harness: fake-torn', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  const rawFile = path.join(result.runDir, 'raw.jsonl');
  const lines = fs.readFileSync(rawFile, 'utf8').split('\n');
  fs.writeFileSync(rawFile, `${lines[0]}\n${lines[1].slice(0, 40)}`);
  crashInLedger(root, result.runId, 1, { scores: true });
  const manifest = readJson(path.join(result.runDir, 'run.json'));
  writeJson(path.join(result.runDir, 'run.json'), { ...manifest, status: 'running', finished_at: null, runner: { pid: manifest.runner.pid, heartbeat_at: '2026-01-01T00:00:00.000Z' } });
  const logs = [];
  assert.deepEqual(await resumeCommand(root, result.runId, { log: (line) => logs.push(line), dryRun: true }), []);
  assert.equal(calls, 3, 'a dry run makes no call');
  assert.match(logs.join('\n'), /1 row\(s\) kept, 2 call\(s\) to make; a torn last line would be dropped/);
  assert.equal(fs.readFileSync(rawFile, 'utf8').endsWith('\n'), false, 'a dry run writes nothing');
  await resumeCommand(root, result.runId, { log: () => {} });
  assert.equal(calls, 5);
  assert.deepEqual(rowsOf(result.runDir).map((row) => row.case_id), ['smoke-001', 'smoke-002', 'smoke-003']);
  assert.equal(readJson(path.join(result.runDir, 'run.json')).runner.resumes[0].dropped_torn_line, true);
  assert.deepEqual(problemsOf(root), []);
});

test('a call cut off by Ctrl+C is not stored, so the resume runs it again', async (t) => {
  const root = tempRoot(t);
  let calls = 0;
  fake(t, 'fake-cut', (question) => {
    calls += 1;
    if (calls === 2) {
      process.emit('SIGINT', 'SIGINT');
      return { error: { type: 'no_result', message: 'killed by Ctrl+C' } };
    }
    return answer(question);
  });
  const file = experiment(root, 'cut', ['repeats: 1', 'cases: [smoke-001, smoke-002]', 'harness: fake-cut', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  assert.deepEqual(rowsOf(result.runDir).map((row) => row.case_id), ['smoke-001']);
  await resumeCommand(root, result.runId, { log: () => {} });
  assert.deepEqual(rowsOf(result.runDir).map((row) => [row.case_id, row.error]), [['smoke-001', null], ['smoke-002', null]]);
});

test('deep review: quota texts are lost, file names are not errors, a -001 stable version matches', () => {
  assert.equal(normalizeErrorType({ type: 'harness_error', message: 'You exceeded your current quota, please check your plan and billing details.' }), 'rate_limit');
  assert.equal(normalizeErrorType({ type: 'insufficient_quota', message: '' }), 'rate_limit');
  assert.equal(normalizeErrorType({ type: 'harness_error', message: 'You have exhausted your daily quota.' }), 'rate_limit');
  assert.equal(normalizeErrorType({ type: 'no_result', message: 'TypeError: x is undefined\n    at node_modules/foo/rate-limit.js:12:3' }), 'no_result');
  assert.equal(normalizeErrorType({ type: 'no_result', message: String.raw`at C:\tools\auth\unauthorized-handler.mjs:4:1` }), 'no_result');
  assert.equal(normalizeErrorType({ type: 'harness_error', message: 'Rate limit reached, see https://example.com/docs/rate-limits' }), 'rate_limit');
  assert.equal(modelCheck('gemini-2.0-flash', 'gemini-2.0-flash-001'), 'match');
  assert.equal(modelCheck('gemini-2.0-flash', 'gemini-2.0-flash-lite-001'), 'mismatch');
});

test('a dashboard stop keeps the failed row of the call it waited for: no hidden retry', async (t) => {
  const root = tempRoot(t);
  let calls = 0;
  fake(t, 'fake-cancel', (question) => {
    calls += 1;
    if (calls === 1) {
      process.emit('SIGINT', 'cancel');
      return { error: { type: 'timeout', message: 'did not exit within 300 s' } };
    }
    return answer(question);
  });
  const file = experiment(root, 'cancel', ['repeats: 1', 'cases: [smoke-001, smoke-002]', 'harness: fake-cancel', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  assert.deepEqual(rowsOf(result.runDir).map((row) => [row.case_id, row.error?.type]), [['smoke-001', 'timeout']]);
  assert.equal(readJson(path.join(result.runDir, 'run.json')).runner.interrupted, true);
});

test('a stop during the last call that still stored its row leaves the run completed', async (t) => {
  const root = tempRoot(t);
  let calls = 0;
  fake(t, 'fake-late', (question) => {
    calls += 1;
    if (calls === 2) process.emit('SIGINT', 'SIGINT');
    return answer(question);
  });
  const file = experiment(root, 'late', ['repeats: 1', 'cases: [smoke-001, smoke-002]', 'harness: fake-late', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  const manifest = readJson(path.join(result.runDir, 'run.json'));
  assert.equal(rowsOf(result.runDir).length, 2);
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.runner.interrupted, undefined);
  assert.doesNotMatch(manifest.notes, /Interrupted/);
});

test('resume: --force overrides a live pid, the dry run checks the harness version, a missing newline is added', async (t) => {
  const root = tempRoot(t);
  let version = '1.0.0';
  let calls = 0;
  fake(t, 'fake-force', (question) => (calls += 1, answer(question)), { version: () => version });
  const file = experiment(root, 'force', ['repeats: 1', 'cases: [smoke-001, smoke-002, smoke-003]', 'harness: fake-force', 'models: [claude-haiku]']);
  const [result] = await runCommand(root, file, { log: () => {} });
  const rawFile = path.join(result.runDir, 'raw.jsonl');
  const lines = fs.readFileSync(rawFile, 'utf8').split('\n');
  // The last kept row is complete JSON but lost its newline in the crash.
  fs.writeFileSync(rawFile, `${lines[0]}\n${lines[1]}`);
  crashInLedger(root, result.runId, 2, { scores: true });
  const manifest = readJson(path.join(result.runDir, 'run.json'));
  writeJson(path.join(result.runDir, 'run.json'), { ...manifest, status: 'running', finished_at: null, runner: { pid: process.pid, heartbeat_at: new Date().toISOString() } });
  await assert.rejects(resumeCommand(root, result.runId, { log: () => {} }), /pass --force/);
  version = '1.0.1';
  await assert.rejects(resumeCommand(root, result.runId, { log: () => {}, force: true, dryRun: true }), /now 1\.0\.1; the run used 1\.0\.0/);
  version = '1.0.0';
  const logs = [];
  await resumeCommand(root, result.runId, { log: (line) => logs.push(line), force: true, dryRun: true });
  assert.match(logs.join('\n'), /2 row\(s\) kept, 1 call\(s\) to make\./);
  await resumeCommand(root, result.runId, { log: () => {}, force: true });
  assert.equal(calls, 4);
  assert.deepEqual(rowsOf(result.runDir).map((row) => row.case_id), ['smoke-001', 'smoke-002', 'smoke-003']);
  assert.deepEqual(problemsOf(root), []);
});
