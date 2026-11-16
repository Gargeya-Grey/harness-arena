import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planExperiment, runCommand } from '../lab/commands/run.mjs';
import { getAdapter } from '../lab/adapters/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['smoke', 'ladder-answer', 'ladder-code', 'ladder-agent', 'visual-web', 'foldaway-apartment-guided', 'foldaway-apartment-scrubbable', 'foldaway-apartment-reversible'];
for (const name of names) test(`${name}: controlled preset pins all three models to high`, async () => {
  const file = path.join(root, 'experiments', `${name === 'smoke' ? name : name + '-repaired'}-explicit-effort.yaml`);
  const plan = planExperiment(root, file);
  assert.equal(plan.experiment.effort_policy, 'explicit');
  assert.equal(plan.timeoutMs, 0);
  const groups = [...plan.groups.values()];
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.effort), ['high', 'high', 'high']);
  assert.deepEqual(groups.flatMap((group) => group.models), ['beam-free', 'claude-haiku-5.5', 'gpt-6.1-terra']);
  const logs = [];
  await runCommand(root, file, { dryRun: true, log: (line) => logs.push(line) });
  assert.equal(logs.filter((line) => /effort high,/.test(line)).length, 3);
});

test('high is encoded in each requested harness command', () => {
  const claude = getAdapter('claude-code').args({ model: 'claude-haiku-5-5', effort: 'high', user: 'q' });
  assert.equal(claude[claude.indexOf('--effort') + 1], 'high');
  const opencode = getAdapter('opencode').args({ model: 'opencode/beam-free', effort: 'high', prompt: 'q' });
  assert.ok(opencode.includes('opencode/beam-free#high'));
  const codex = getAdapter('codex').args({ model: 'gpt-6.1-terra', effort: 'high', prompt: 'q' });
  assert.ok(codex.includes('model_reasoning_effort="high"'));
});
