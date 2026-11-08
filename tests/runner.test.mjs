// The runner end to end with a fake harness: no model calls. It runs over a
// temp copy of the fixture repo, so results/ in this repository is untouched.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { runCommand } from '../lab/commands/run.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { readJson, readJsonl } from '../lab/lib/fsutil.mjs';
import { buildState } from '../lab/lib/state.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

function fakeHarness(name, answer) {
  return {
    name,
    kind: 'cli',
    entrypoint: 'headless',
    access_method: 'subscription',
    supports_effort: false,
    detect: async () => ({ version: '0.0.1' }),
    applied: () => ({}),
    async call({ messages, cwd }) {
      if (answer instanceof Error) throw answer;
      const question = messages.at(-1).content;
      return {
        text: answer(question),
        finish_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 2, cache_read_tokens: 40, cache_write_tokens: 0 },
        wall_ms: 10,
        events: [{ type: 'result', cwd }],
      };
    },
  };
}

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-runner-'));
  fs.cpSync(FIXTURES, root, { recursive: true });
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  return root;
}

function experiment(root, harness) {
  const file = path.join(root, 'experiments', `${harness}.yaml`);
  fs.writeFileSync(
    file,
    [
      `id: ${harness}`,
      'suite: smoke',
      'prompt: qa-single-turn',
      'repeats: 2',
      `harness: ${harness}`,
      'models: [claude-haiku, gpt-4o-mini]',
      'evaluators:',
      '  - id: exact-match',
      '    version: "1"',
      '    dimension: quality',
      '',
    ].join('\n'),
  );
  return file;
}

test('a full run writes one row per model x case x repeat, scores it and validates', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ADAPTERS['fake-ok'] = fakeHarness('fake-ok', (question) => (question.includes('2 + 2') ? '4' : 'unknown'));
  t.after(() => delete ADAPTERS['fake-ok']);

  const before = new Set(fs.readdirSync(path.join(root, 'results')));
  const [result] = await runCommand(root, experiment(root, 'fake-ok'), { log: () => {} });
  assert.equal(result.status, 'completed');
  assert.ok(!before.has(result.runId));

  const manifest = readJson(path.join(result.runDir, 'run.json'));
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.harness.name, 'fake-ok');
  assert.equal(manifest.harness.settings.workdir_git_fence, true);
  const { rows } = readJsonl(path.join(result.runDir, 'raw.jsonl'));
  const cases = fs.readFileSync(path.join(root, 'datasets', 'smoke', 'cases.jsonl'), 'utf8').trim().split('\n').length;
  assert.equal(rows.length, 2 * cases * 2);
  assert.ok(rows.every((row) => row.cost_usd > 0 && row.error === null));

  const { rows: scores } = readJsonl(path.join(result.runDir, 'scores', 'exact-match@1.jsonl'));
  assert.equal(scores.length, rows.length);
  assert.equal(scores.filter((score) => score.passed).length, 2 * 2, 'only smoke-001 is answered right, for 2 models x 2 repeats');

  const events = fs.readFileSync(path.join(result.runDir, 'harness-events.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.length, rows.length);
  assert.equal(new Set(events.map((e) => e.event.cwd)).size, rows.length, 'every call has its own workdir');
  assert.ok(!events[0].event.cwd.startsWith(root), 'the harness ran outside the data root');

  assert.deepEqual(validateRepo(root).problems, []);
  const state = buildState(root);
  assert.ok(state.configs['claude-haiku__fake-ok-0.0.1__default'], 'the new configuration is indexed');
});

test('an adapter that throws gives error rows and a failed run, never a stuck one', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ADAPTERS['fake-throw'] = fakeHarness('fake-throw', new Error('boom'));
  t.after(() => delete ADAPTERS['fake-throw']);

  const [result] = await runCommand(root, experiment(root, 'fake-throw'), { log: () => {}, repeats: 1, cases: ['smoke-001'] });
  assert.equal(result.status, 'failed');
  const { rows } = readJsonl(path.join(result.runDir, 'raw.jsonl'));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.error.type === 'harness_error' && /boom/.test(row.error.message)));
  assert.equal(fs.existsSync(path.join(result.runDir, 'scores', 'exact-match@1.jsonl')) ? readJsonl(path.join(result.runDir, 'scores', 'exact-match@1.jsonl')).rows.length : 0, 0, 'error rows are not scored');
  assert.deepEqual(validateRepo(root).problems, []);
});

test("stored events and errors never hold the user's setup or home folder", async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = os.homedir();
  const leaky = fakeHarness('fake-leaky', () => '4');
  leaky.call = async ({ cwd }) => ({
    error: { type: 'auth', message: `failed at ${path.join(home, 'AppData', 'npm', 'cli.js')}` },
    events: [{ type: 'system', cwd, mcp_servers: ['claude.ai Gmail'], memory_paths: { auto: path.join(home, '.claude', 'memory') }, workspace: { gitStatus: '?? .private-folder/' } }],
  });
  ADAPTERS['fake-leaky'] = leaky;
  t.after(() => delete ADAPTERS['fake-leaky']);

  const [result] = await runCommand(root, experiment(root, 'fake-leaky'), { log: () => {}, repeats: 1, cases: ['smoke-001'] });
  const stored = ['raw.jsonl', 'harness-events.ndjson'].map((f) => fs.readFileSync(path.join(result.runDir, f), 'utf8')).join('\n');
  const homeJson = JSON.stringify(home).slice(1, -1);
  assert.ok(!stored.includes(homeJson) && !stored.includes(home), 'no home folder path is stored');
  assert.ok(!stored.includes('private-folder') && !stored.includes('Gmail') && !stored.includes('.claude'), 'no setup data is stored');
  const { rows } = readJsonl(path.join(result.runDir, 'raw.jsonl'));
  assert.match(rows[0].error.message, /failed at ~[\\/]AppData/);
  assert.deepEqual(validateRepo(root).problems, []);
});

test('dry run calls nothing and writes nothing', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  ADAPTERS['fake-dry'] = { ...fakeHarness('fake-dry', () => '4'), call: async () => ((calls += 1), {}) };
  t.after(() => delete ADAPTERS['fake-dry']);
  const before = fs.readdirSync(path.join(root, 'results')).length;
  const lines = [];
  await runCommand(root, experiment(root, 'fake-dry'), { dryRun: true, log: (line) => lines.push(line) });
  assert.equal(calls, 0);
  assert.equal(fs.readdirSync(path.join(root, 'results')).length, before);
  assert.ok(lines.some((line) => /Dry run/.test(line)));
});

test('user_config isolated: the flags reach the call, the run records them, and the config is its own', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const seen = [];
  const harness = fakeHarness('fake-iso', () => '4');
  const call = harness.call;
  harness.isolation = { args: ['--no-user-setup'], env: {}, note: 'Fake isolation.' };
  harness.call = async (options) => (seen.push(options.isolated), call(options));
  ADAPTERS['fake-iso'] = harness;
  t.after(() => delete ADAPTERS['fake-iso']);

  const file = experiment(root, 'fake-iso');
  fs.appendFileSync(file, 'user_config: isolated\n');
  const [isolated] = await runCommand(root, file, { log: () => {}, repeats: 1, cases: ['smoke-001'] });
  const settings = readJson(path.join(isolated.runDir, 'run.json')).harness.settings;
  assert.equal(settings.user_config, 'isolated');
  assert.deepEqual(settings.user_config_flags, ['--no-user-setup']);
  assert.deepEqual(seen, [true, true]);

  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('user_config: isolated\n', ''));
  const [loaded] = await runCommand(root, file, { log: () => {}, repeats: 1, cases: ['smoke-001'] });
  assert.equal(readJson(path.join(loaded.runDir, 'run.json')).harness.settings.user_config, 'loaded');
  assert.deepEqual(seen, [true, true, false, false]);

  assert.deepEqual(validateRepo(root).problems, []);
  const state = buildState(root);
  // No table of required flags names this fake harness, so its record proves nothing: setup state unknown.
  assert.ok(state.configs['claude-haiku__fake-iso-0.0.1__default__isolated-unknown']);
  assert.equal(state.configs['claude-haiku__fake-iso-0.0.1__default__isolated-unknown'].legacy_id, 'claude-haiku__fake-iso-0.0.1__default__isolated');
  assert.ok(state.configs['claude-haiku__fake-iso-0.0.1__default']);
  const context = state.contexts.find((c) => c.config_ids.includes('claude-haiku__fake-iso-0.0.1__default__isolated-unknown'));
  assert.ok(context.config_ids.includes('claude-haiku__fake-iso-0.0.1__default'), 'both setups sit in one context');
});

test('user_config isolated on a harness with no isolation flags records loaded', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ADAPTERS['fake-noiso'] = fakeHarness('fake-noiso', () => '4');
  t.after(() => delete ADAPTERS['fake-noiso']);
  const file = experiment(root, 'fake-noiso');
  fs.appendFileSync(file, 'user_config: isolated\n');
  const lines = [];
  const [result] = await runCommand(root, file, { log: (line) => lines.push(line), repeats: 1, cases: ['smoke-001'] });
  const settings = readJson(path.join(result.runDir, 'run.json')).harness.settings;
  assert.equal(settings.user_config, 'loaded');
  assert.equal(settings.user_config_requested, 'isolated');
  assert.ok(lines.some((line) => /cannot skip the user setup/.test(line)));
});

test('an unknown user_config value stops the run before any call', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ADAPTERS['fake-bad'] = fakeHarness('fake-bad', () => '4');
  t.after(() => delete ADAPTERS['fake-bad']);
  const file = experiment(root, 'fake-bad');
  fs.appendFileSync(file, 'user_config: clean\n');
  await assert.rejects(runCommand(root, file, { log: () => {} }), /user_config must be "loaded" or "isolated"/);
});
