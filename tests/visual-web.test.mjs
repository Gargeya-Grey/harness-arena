import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCheck, runWorkspaceCheckV2 } from '../lab/evaluators/index.mjs';
import { loadLadder } from '../lab/lib/ladder.mjs';
import { loadPrompt, loadSuite, loadYamlFile } from '../lab/lib/repo.mjs';
import { SchemaSet } from '../lab/lib/schema.mjs';
import { copyTree, snapshotWorkspace } from '../lab/lib/workspace.mjs';
import { browserObservationProblems } from '../tools/visual-web/inspect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suite = loadSuite(ROOT, 'visual-web');

test('visual pilot cases have valid stored records and explicitly estimated levels', () => {
  const schemas = new SchemaSet(path.join(ROOT, 'schemas'));
  const ladder = loadLadder(ROOT);
  assert.equal(suite.cases.length, 5);
  assert.deepEqual(suite.cases.map((item) => item.metadata.tier.level), [1, 2, 3, 4, 5]);
  const prompt = loadPrompt(ROOT, 'visual-web', '1');
  assert.deepEqual(prompt.variables, ['task']);
  for (const item of suite.cases) {
    assert.deepEqual(schemas.validate('case.schema.json', item), [], item.case_id);
    assert.equal(item.expected.check, 'delivery');
    assert.ok(item.input.task.length > 100);
    assert.ok(fs.existsSync(path.join(suite.dir, 'workspaces', item.input.workspace, 'README.md')));
    assert.match(item.metadata.tier.basis, /[Uu]ntimed estimate/);
    const range = ladder.tiers.find((tier) => tier.level === item.metadata.tier.level);
    assert.equal(item.metadata.tier.name, range.name);
    assert.ok(item.metadata.tier.human_minutes > range.minutes[0]);
    assert.ok(item.metadata.tier.human_minutes <= range.minutes[1]);
    assert.equal(item.metadata.browser.version, 2);
    assert.ok(item.metadata.visual_review.length >= 3);
  }
});

test('browser observations distinguish failed, blocked and incomplete checks', () => {
  const report = { kind: 'visual-web-browser-observation', version: '2', created_at: '2026-11-16T00:00:00Z', limits: ['Derived, not native score'], checker_sha256: 'a'.repeat(64), suite_checkers: {}, runs: [], cleanup: {}, observations: [{ run_id: 'r', case_id: 'visual-web-room-planner', model_key: 'm', repeat: 0, latency_ms: null, error: null, screenshots: [], checks: [{ name: 'night', passed: false, error: 'Missing control' }, { name: 'restore', passed: null, status: 'blocked', blocked_by: ['night'] }, { name: 'transition', passed: null, status: 'incomplete', reason: 'Observed transition still running' }] }] };
  assert.deepEqual(browserObservationProblems(report), []);
  const invalid = structuredClone(report);
  invalid.observations[0].checks[1].passed = false;
  assert.match(browserObservationProblems(invalid).join('\n'), /unjudged check cannot carry a boolean/);
  const missing = structuredClone(report);
  delete missing.observations[0].checks[2].reason;
  assert.match(browserObservationProblems(missing).join('\n'), /incomplete needs a reason/);
  const absent = structuredClone(report);
  absent.observations[0].checks[1].blocked_by = ['unknown'];
  assert.match(browserObservationProblems(absent).join('\n'), /absent or passed/);
  const wrongType = structuredClone(report);
  wrongType.observations[0].checks[0].passed = 'false';
  assert.match(browserObservationProblems(wrongType).join('\n'), /expected boolean or null/);
  const invalidNested = structuredClone(report);
  invalidNested.observations[0].checks.unshift(null);
  assert.ok(browserObservationProblems(invalidNested).length > 0, 'invalid nested checks are validation errors, never a validator crash');
});

function delivery(t, content) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-visual-delivery-'));
  t.after(() => {
    assert.equal(path.dirname(scratch), fs.realpathSync(os.tmpdir()));
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  const fixtureDir = path.join(suite.dir, 'workspaces', 'event-page');
  const workDir = path.join(scratch, 'work');
  const runDir = path.join(scratch, 'run');
  fs.mkdirSync(runDir);
  copyTree(fixtureDir, workDir);
  if (content !== undefined) fs.writeFileSync(path.join(workDir, 'index.html'), content);
  const manifest = snapshotWorkspace({
    fixtureDir,
    workDir,
    runDir,
    base: 'artifacts/delivery/workspace',
    artifactId: 'delivery-workspace',
    createdAt: '2026-11-15T00:00:00Z',
  });
  return runWorkspaceCheckV2({
    fixtureDir,
    check: loadCheck(path.join(suite.dir, 'checks'), 'delivery'),
    runDir,
    manifestPath: manifest.path,
  });
}

test('delivery check rejects a missing index.html', (t) => {
  const result = delivery(t);
  assert.equal(result.error, undefined);
  assert.equal(result.results.filter((item) => item.ok).length, 0);
});

test('delivery check rejects an empty or whitespace-only index.html', (t) => {
  for (const content of ['', ' \n\t']) {
    const result = delivery(t, content);
    assert.equal(result.error, undefined);
    assert.equal(result.results.find((item) => item.name === 'index.html is nonempty').ok, false);
  }
});

test('delivery check accepts a page while leaving visual quality unjudged', (t) => {
  for (const content of ['<!doctype html><html lang="en"><title>Example</title><body><main>Hello</main></body></html>', 'A nonempty file that is not a working page']) {
    const result = delivery(t, content);
    assert.equal(result.error, undefined);
    assert.ok(result.results.every((item) => item.ok));
  }
});

test('the live pilot declares the requested three configurations and delivery-only dimension', () => {
  const experiment = loadYamlFile(path.join(ROOT, 'experiments', 'visual-web-pilot.yaml'));
  assert.deepEqual(experiment.targets, [
    { model: 'beam-free', harness: 'opencode' },
    { model: 'claude-haiku-5.5', harness: 'claude-code' },
    { model: 'gpt-6.1-terra', harness: 'codex', effort: 'high' },
  ]);
  assert.equal(experiment.prompt_version, '1');
  assert.equal(experiment.repeats, 1);
  assert.equal(experiment.workdir, 'isolated');
  assert.equal(experiment.user_config, 'isolated');
  assert.equal(experiment.access, 'edit');
  assert.deepEqual(experiment.evaluators, [{ id: 'workspace-tests', version: '2', dimension: 'format' }]);
  const installed = loadYamlFile(path.join(ROOT, 'experiments', 'visual-web-codex-installed.yaml'));
  assert.deepEqual(installed.targets, [{ model: 'gpt-6.1-terra', harness: 'codex', effort: 'high' }]);
  assert.equal(installed.user_config, 'loaded', 'Windows reuses the existing sandbox installation');
  assert.equal(installed.workdir, 'isolated');
  assert.equal(installed.access, 'edit');
});
