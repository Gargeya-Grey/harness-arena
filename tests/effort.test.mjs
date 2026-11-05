// Effort per target: two efforts of one model are two runs and two configurations.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { resumeCommand, runCommand } from '../lab/commands/run.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { readJson, readJsonl, writeJson } from '../lab/lib/fsutil.mjs';
import { resolveExperiment } from '../lab/lib/repo.mjs';
import { buildState } from '../lab/lib/state.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'repo');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-effort-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(FIXTURES, root, { recursive: true });
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  return root;
}

function fake(t, name, { effort = true, calls = [] } = {}) {
  ADAPTERS[name] = {
    name,
    kind: 'cli',
    entrypoint: 'headless',
    access_method: 'subscription',
    supports_effort: effort,
    detect: async () => ({ version: '1.0.0' }),
    applied: () => ({}),
    async call(ctx) {
      calls.push(`${ctx.model}@${ctx.effort ?? 'default'}`);
      return { text: 'x', finish_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, wall_ms: 1, events: [] };
    },
  };
  t.after(() => delete ADAPTERS[name]);
  return calls;
}

function experiment(root, id, lines) {
  const file = path.join(root, 'experiments', `${id}.yaml`);
  fs.writeFileSync(file, [`id: ${id}`, 'suite: smoke', 'prompt: qa-single-turn', 'repeats: 1', 'cases: [smoke-001]', ...lines, 'evaluators:', '  - id: exact-match', '    version: "1"', '    dimension: quality', ''].join('\n'));
  return file;
}

const registry = { m: { model: 'm', reasoning_effort: 'medium' } };

test('resolveExperiment expands efforts, keeps the registry effort when none is given, and refuses bad values', () => {
  const { targets, problems } = resolveExperiment({ id: 'x', suite: 's', prompt: 'p', targets: [{ model: 'm', harness: 'h', efforts: ['low', 'high'] }, { model: 'm', harness: 'h' }] }, registry);
  assert.deepEqual(problems, []);
  assert.deepEqual(targets.map((t) => t.effort), ['low', 'high', undefined]);
  const both = resolveExperiment({ id: 'x', suite: 's', prompt: 'p', targets: [{ model: 'm', harness: 'h', effort: 'low', efforts: ['high'] }] }, registry);
  assert.match(both.problems.join('\n'), /not both/);
  const bad = resolveExperiment({ id: 'x', suite: 's', prompt: 'p', targets: [{ model: 'm', harness: 'h', efforts: ['High!'] }] }, registry);
  assert.match(bad.problems.join('\n'), /must be a word/);
  const level = resolveExperiment({ id: 'x', suite: 's', prompt: 'p', harness: 'h', effort: 'low', models: ['m'] }, registry);
  assert.deepEqual(level.targets.map((t) => t.effort), ['low'], 'an experiment-level effort applies to every target');
});

test('two efforts of one model run as two runs, record their effort, and show as two configurations', async (t) => {
  const root = tempRoot(t);
  const calls = fake(t, 'fake-effort');
  const file = experiment(root, 'efforts', ['targets:', '  - model: claude-haiku', '    harness: fake-effort', '    efforts: [low, high, default]']);
  const logs = [];
  await runCommand(root, file, { log: (line) => logs.push(line), dryRun: true });
  assert.match(logs.join('\n'), /3 call\(s\) in 3 run\(s\)/);
  assert.match(logs.join('\n'), /effort low/);
  assert.match(logs.join('\n'), /effort high/);
  const results = await runCommand(root, file, { log: () => {} });
  assert.equal(results.length, 3);
  assert.deepEqual(calls.map((c) => c.split('@')[1]).sort(), ['default', 'high', 'low']);
  const efforts = results.map((r) => readJson(path.join(r.runDir, 'run.json')).models[0].reasoning_effort).sort();
  assert.deepEqual(efforts, [null, 'high', 'low'].sort());
  const state = buildState(root);
  const ctx = state.contexts.find((item) => results.every((r) => item.runs.includes(r.runId)));
  assert.ok(ctx, 'the three runs form one comparison context');
  const mine = ctx.config_ids.filter((id) => state.configs[id].harness.name === 'fake-effort');
  assert.deepEqual(mine.map((id) => state.configs[id].effort ?? 'default').sort(), ['default', 'high', 'low']);
  assert.deepEqual(validateRepo(root).problems, []);
});

test('two targets that run at the same effective effort are one configuration and are refused', async (t) => {
  const root = tempRoot(t);
  fake(t, 'fake-dup');
  fake(t, 'fake-dup-noeffort', { effort: false });
  const registryEffort = (await import('../lab/lib/repo.mjs')).loadRegistry(root)['claude-haiku']?.reasoning_effort;
  const same = experiment(root, 'dup', ['targets:', '  - model: claude-haiku', '    harness: fake-dup', `    effort: ${registryEffort ?? 'default'}`, '  - model: claude-haiku', '    harness: fake-dup']);
  await assert.rejects(runCommand(root, same, { log: () => {}, dryRun: true }), /listed twice/);
  // A harness without effort control runs both at its default: the same configuration.
  const noEffort = experiment(root, 'dup2', ['targets:', '  - model: claude-haiku', '    harness: fake-dup-noeffort', '    effort: default', '  - model: claude-haiku', '    harness: fake-dup-noeffort']);
  await assert.rejects(runCommand(root, noEffort, { log: () => {}, dryRun: true }), /listed twice/);
  assert.match(validateRepo(root).problems.map((p) => p.message || p).join('\n'), /listed twice at the same effort/);
});

test('an effort on a harness without effort control is refused before any call', async (t) => {
  const root = tempRoot(t);
  const calls = fake(t, 'fake-noeffort', { effort: false });
  const file = experiment(root, 'noeffort', ['targets:', '  - model: claude-haiku', '    harness: fake-noeffort', '    effort: high']);
  await assert.rejects(runCommand(root, file, { log: () => {} }), /no effort control/);
  assert.equal(calls.length, 0);
  assert.match(validateRepo(root).problems.map((p) => p.message || p).join('\n'), /no effort control/);
});

test('a stopped run of one effort resumes at that effort', async (t) => {
  const root = tempRoot(t);
  const calls = fake(t, 'fake-resume-effort');
  const file = experiment(root, 'reffort', ['targets:', '  - model: claude-haiku', '    harness: fake-resume-effort', '    efforts: [low, high]']);
  const results = await runCommand(root, file, { log: () => {} });
  const high = results.find((r) => readJson(path.join(r.runDir, 'run.json')).models[0].reasoning_effort === 'high');
  fs.writeFileSync(path.join(high.runDir, 'raw.jsonl'), '');
  fs.rmSync(path.join(high.runDir, 'scores'), { recursive: true, force: true });
  const manifest = readJson(path.join(high.runDir, 'run.json'));
  writeJson(path.join(high.runDir, 'run.json'), { ...manifest, status: 'running', finished_at: null, runner: { pid: manifest.runner.pid, heartbeat_at: '2026-01-01T00:00:00.000Z' } });
  calls.length = 0;
  await resumeCommand(root, high.runId, { log: () => {} });
  assert.deepEqual(calls.map((c) => c.split('@')[1]), ['high']);
  assert.equal(readJsonl(path.join(high.runDir, 'raw.jsonl')).rows.length, 1);
});
