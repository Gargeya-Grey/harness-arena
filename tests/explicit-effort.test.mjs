import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { runCommand, resumeCommand } from '../lab/commands/run.mjs';
import { readJson, readJsonl, writeJson } from '../lab/lib/fsutil.mjs';
import { buildState } from '../lab/lib/state.mjs';
import { crashInLedger } from './crash.mjs';
import { catalog } from '../dashboard/jobs.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/repo');

function setup(t, { supportsEffort = true, levels = ['low', 'high'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-explicit-effort-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(fixture, root, { recursive: true });
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  fs.appendFileSync(path.join(root, 'configs/models.yaml'), `\n  effort-test:\n    provider: test\n    model: effort-test\n    reasoning_effort: high\n    effort_levels: [${levels.join(', ')}]\n    params: {}\n`);
  const calls = [];
  const name = 'explicit-effort-fake';
  ADAPTERS[name] = {
    name, kind: 'cli', entrypoint: 'headless', access_method: 'subscription', supports_effort: supportsEffort,
    detect: async () => ({ version: '1.0.0' }),
    applied: ({ effort }) => effort ? { reasoning_effort: effort } : {},
    async call(ctx) {
      calls.push(ctx.effort);
      return { text: '4', finish_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, wall_ms: 1, events: [] };
    },
  };
  t.after(() => delete ADAPTERS[name]);
  const experiment = (effortLine, policy = 'explicit') => {
    const file = path.join(root, 'experiments/effort-check.yaml');
    fs.writeFileSync(file, `id: effort-check\nsuite: smoke\nprompt: qa-single-turn\nrepeats: 1\ncases: [smoke-001]\n${policy ? `effort_policy: ${policy}\n` : ''}targets:\n  - model: effort-test\n    harness: ${name}\n${effortLine ? `    ${effortLine}\n` : ''}evaluators:\n  - id: exact-match\n    version: "1"\n    dimension: quality\n`);
    return file;
  };
  return { root, calls, experiment };
}

test('an explicit-effort comparison rejects omitted or default effort before dispatch', async (t) => {
  const { root, calls, experiment } = setup(t);
  for (const effortLine of ['', 'effort: default']) {
    await assert.rejects(runCommand(root, experiment(effortLine), { dryRun: true, log: () => {} }), /explicit.*effort|effort.*explicit/i);
  }
  assert.deepEqual(calls, []);
});

test('project policy blocks new implicit runs even when an old preset omits its policy', async (t) => {
  const { root, calls, experiment } = setup(t);
  fs.writeFileSync(path.join(root, 'configs/effort-policy.yaml'), 'require: explicit\n');
  await assert.rejects(runCommand(root, experiment('', ''), { dryRun: true, log: () => {} }), /named effort/);
  assert.match(catalog(root).experiments.find((item) => item.id === 'effort-check').problems.join(' '), /named effort/);
  await runCommand(root, experiment('effort: high', ''), { dryRun: true, log: () => {} });
  await assert.rejects(runCommand(root, experiment('effort: high', 'typo'), { dryRun: true, log: () => {} }), /effort_policy/);
  fs.writeFileSync(path.join(root, 'configs/effort-policy.yaml'), '');
  await assert.rejects(runCommand(root, experiment('effort: high', ''), { dryRun: true, log: () => {} }), /effort-policy/);
  assert.ok(validateRepo(root).problems.some((message) => message.includes('effort-policy.yaml')));
  assert.deepEqual(calls, []);
});

test('strict comparisons refuse missing or malformed model effort capability evidence', async (t) => {
  for (const replacement of ['', '    effort_levels: high\n']) await t.test(replacement ? 'malformed' : 'missing', async (subtest) => {
    const { root, calls, experiment } = setup(subtest);
    const registryFile = path.join(root, 'configs/models.yaml');
    fs.writeFileSync(registryFile, fs.readFileSync(registryFile, 'utf8').replace(/^    effort_levels:.*\n/m, replacement));
    await assert.rejects(runCommand(root, experiment('effort: high'), { dryRun: true, log: () => {} }), /verified|capability|effort_levels/i);
    assert.deepEqual(calls, []);
  });
});

test('a declared supported effort reaches dispatch and an unsupported level is refused', async (t) => {
  const { root, calls, experiment } = setup(t);
  await assert.rejects(runCommand(root, experiment('effort: extreme'), { dryRun: true, log: () => {} }), /supported effort|effort levels/i);
  assert.deepEqual(calls, []);
  const [result] = await runCommand(root, experiment('effort: high'), { log: () => {} });
  assert.deepEqual(calls, ['high']);
  assert.equal(readJson(path.join(result.runDir, 'run.json')).models[0].reasoning_effort, 'high');
  assert.equal(readJsonl(path.join(result.runDir, 'raw.jsonl')).rows[0].metadata.effort_requested, 'high');
});

test('unavailable effort is recorded distinctly and sends no provider effort flag', async (t) => {
  const { root, calls, experiment } = setup(t, { levels: [] });
  const logs = [];
  await runCommand(root, experiment('effort: unavailable'), { dryRun: true, log: (line) => logs.push(line) });
  assert.match(logs.join('\n'), /effort unavailable/);
  const [result] = await runCommand(root, experiment('effort: unavailable'), { log: (line) => logs.push(line) });
  assert.deepEqual(calls, [null]);
  const manifest = readJson(path.join(result.runDir, 'run.json'));
  assert.equal(manifest.models[0].reasoning_effort, 'unavailable');
  assert.equal(manifest.models[0].params.reasoning_effort, undefined);
  assert.doesNotMatch(logs.join('\n'), /harness default.*unavailable/);
  const state = buildState(root);
  assert.ok(Object.keys(state.configs).some((id) => id.startsWith('effort-test__explicit-effort-fake-1.0.0__unavailable')));
});

test('an unavailable designation needs evidence of unavailable control', async (t) => {
  const { root, calls, experiment } = setup(t);
  await assert.rejects(runCommand(root, experiment('effort: unavailable'), { dryRun: true, log: () => {} }), /unavailable.*control|control.*unavailable/i);
  assert.deepEqual(calls, []);
});

test('a harness without effort control accepts only an unavailable designation', async (t) => {
  const { root, calls, experiment } = setup(t, { supportsEffort: false });
  await assert.rejects(runCommand(root, experiment('effort: high'), { dryRun: true, log: () => {} }), /no effort control/);
  const [result] = await runCommand(root, experiment('effort: unavailable'), { log: () => {} });
  assert.deepEqual(calls, [null]);
  assert.equal(readJson(path.join(result.runDir, 'run.json')).models[0].reasoning_effort, 'unavailable');
});

test('legacy default and explicit unavailable runs resume with their recorded effort designations', async (t) => {
  for (const unavailable of [false, true]) await t.test(unavailable ? 'unavailable' : 'legacy default', async (subtest) => {
    const { root, calls, experiment } = setup(subtest, { levels: unavailable ? [] : ['low', 'high'] });
    const file = experiment(`effort: ${unavailable ? 'unavailable' : 'default'}`, unavailable ? 'explicit' : '');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('repeats: 1', 'repeats: 2'));
    const [result] = await runCommand(root, file, { log: () => {} });
    const rawFile = path.join(result.runDir, 'raw.jsonl');
    fs.writeFileSync(rawFile, `${fs.readFileSync(rawFile, 'utf8').trim().split('\n')[0]}\n`);
    fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
    crashInLedger(root, result.runId, 1);
    const manifestFile = path.join(result.runDir, 'run.json');
    const manifest = readJson(manifestFile);
    writeJson(manifestFile, { ...manifest, status: 'running', finished_at: null, runner: { ...manifest.runner, heartbeat_at: '2026-01-01T00:00:00.000Z' } });
    calls.length = 0;
    fs.writeFileSync(path.join(root, 'configs/effort-policy.yaml'), 'require: explicit\n');
    await resumeCommand(root, result.runId, { log: () => {} });
    assert.deepEqual(calls, [null]);
    assert.equal(readJson(manifestFile).models[0].reasoning_effort, unavailable ? 'unavailable' : null);
    assert.equal(readJsonl(rawFile).rows.length, 2);
  });
});
