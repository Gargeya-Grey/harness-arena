import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { runCommand, resumeCommand } from '../lab/commands/run.mjs';
import { adoptCommand } from '../lab/commands/adopt.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/repo');

test('a resumed legacy run retains its recorded deadline when the default changes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-resume-deadline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(fixtures, root, { recursive: true });
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  const deadlines = [];
  ADAPTERS['deadline-resume'] = {
    name: 'deadline-resume', kind: 'cli', entrypoint: 'headless', access_method: 'subscription', supports_effort: false,
    detect: async () => ({ version: '0.0.1' }), applied: () => ({}),
    call: async ({ timeoutMs }) => {
      deadlines.push(timeoutMs);
      return { text: '4', wall_ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, events: [] };
    },
  };
  t.after(() => delete ADAPTERS['deadline-resume']);
  const file = path.join(root, 'experiments/deadline-resume.yaml');
  fs.writeFileSync(file, 'id: deadline-resume\nsuite: smoke\nprompt: qa-single-turn\nrepeats: 2\ncases: [smoke-001, smoke-002]\nharness: deadline-resume\nmodels: [claude-haiku]\nevaluators:\n  - id: exact-match\n    version: "1"\n    dimension: quality\n');
  const [result] = await runCommand(root, file, { log: () => {} });
  const rawFile = path.join(result.runDir, 'raw.jsonl');
  const manifestFile = path.join(result.runDir, 'run.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.writeFileSync(rawFile, `${fs.readFileSync(rawFile, 'utf8').trim().split('\n').slice(0, 2).join('\n')}\n`);
  manifest.status = 'running';
  manifest.finished_at = null;
  manifest.runner.heartbeat_at = '2026-01-01T00:00:00.000Z';
  manifest.harness.settings.timeout_s = 300;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  adoptCommand(root, [result.runId], { log: () => {} });
  deadlines.length = 0;
  await resumeCommand(root, result.runId, { log: () => {} });
  assert.deepEqual(deadlines, [300000, 300000]);
  const resumed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(resumed.harness.settings.timeout_s, 300);
  assert.equal(resumed.experiment.timeout_s, undefined);
});
