// Evaluators, planning, validation and the derived state, on the generated
// fixture repo (tests/fixtures/repo) and on this repository.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEvaluator, normalizeAnswer } from '../lab/evaluators/index.mjs';
import { planExperiment } from '../lab/commands/run.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { buildState, comparisonMode, configId } from '../lab/lib/state.mjs';
import { REPO_ROOT } from '../lab/lib/repo.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');
const score = (key, text, testCase) => getEvaluator(...key.split('@')).score({ raw: { response: { text } }, testCase });

test('evaluators: exact match is byte-exact after trim', () => {
  assert.equal(score('exact-match@1', ' 4\n', { expected: '4' }).passed, true);
  assert.equal(score('exact-match@1', '4.', { expected: '4' }).passed, false);
  assert.equal(score('exact-match@1', '4', {}), null);
});

test('evaluators: normalized match forgives case, quotes and end punctuation', () => {
  assert.equal(normalizeAnswer(' "Paris." '), 'paris');
  assert.equal(score('normalized-match@1', 'PARIS!', { expected: 'Paris' }).passed, true);
  assert.equal(score('normalized-match@1', 'Lyon', { expected: ['Paris', 'paris france'] }).passed, false);
});

test('evaluators: svg structure checks size, safety and balance', () => {
  const input = { width: 100, height: 50 };
  const good = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect width="10" height="10"/></svg>';
  assert.equal(score('svg-structure@1', good, { input }).passed, true);
  const unsafe = '<svg width="100" height="50" viewBox="0 0 100 50"><script>x()</script></svg>';
  const result = score('svg-structure@1', unsafe, { input });
  assert.equal(result.passed, false);
  assert.equal(result.details.checks.no_script, false);
  const none = score('svg-structure@1', 'no svg here', { input });
  assert.equal(none.passed, false);
  assert.equal(none.details.checks.has_svg_root, false);
});

test('configId and comparison mode', () => {
  assert.equal(configId('claude-haiku-5.5', { name: 'claude-code', version: '2.1.306' }, null), 'claude-haiku-5.5__claude-code-2.1.306__default');
  const a = { model_key: 'm1', harness: { name: 'h', version: '1' }, effort: null, params: {} };
  assert.deepEqual(comparisonMode([a, { ...a, model_key: 'm2' }]), { mode: 'controlled', axes: ['model'] });
  assert.deepEqual(comparisonMode([a, { ...a, harness: { name: 'h2', version: '1' } }]), { mode: 'controlled', axes: ['harness'] });
  assert.equal(comparisonMode([a, { ...a, model_key: 'm2', harness: { name: 'h2', version: '1' } }]).mode, 'descriptive');
  assert.equal(comparisonMode([a, { ...a }]).mode, 'replicate');
});

// Every temp folder a test makes is removed when the file's tests finish.
const tempDirs = [];
test.after(() => tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function tempExperiment(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-test-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'exp.yaml');
  fs.writeFileSync(file, body);
  return file;
}

test('plan: groups targets by harness and applies filters', () => {
  const file = path.join(REPO_ROOT, 'experiments', 'smoke-harness-sweep.yaml');
  const plan = planExperiment(REPO_ROOT, file, { repeats: 1, cases: ['smoke-001'] });
  assert.deepEqual([...plan.groups.keys()].sort(), ['claude-code', 'codex', 'command-code']);
  assert.equal(plan.cases.length, 1);
  assert.equal(plan.workdirMode, 'isolated');
  const one = planExperiment(REPO_ROOT, file, { models: ['gpt-6-luna-low'] });
  assert.deepEqual([...one.groups.entries()], [['codex', ['gpt-6-luna-low']]]);
  assert.throws(() => planExperiment(REPO_ROOT, file, { harness: 'nope' }), /No target matches/);
});

test('plan: refuses unknown cases, models, harnesses and bad repeats before any call', () => {
  const base = 'id: t\nsuite: smoke\nprompt: qa-single-turn\n';
  assert.throws(() => planExperiment(REPO_ROOT, tempExperiment(`${base}harness: codex\nmodels: [no-such-model]\n`)), /not in configs\/models\.yaml/);
  assert.throws(() => planExperiment(REPO_ROOT, tempExperiment(`${base}harness: no-such-harness\nmodels: [gpt-6-luna-low]\n`)), /harness/i);
  assert.throws(() => planExperiment(REPO_ROOT, tempExperiment(`${base}harness: codex\nmodels: [gpt-6-luna-low]\ncases: [smoke-999]\n`)), /smoke-999/);
  assert.throws(() => planExperiment(REPO_ROOT, tempExperiment(`${base}harness: codex\nmodels: [gpt-6-luna-low]\nrepeats: 0\n`)), /repeats/);
});

test('validate: this repository and the fixture repo have no problems', () => {
  for (const root of [REPO_ROOT, FIXTURES]) {
    const { problems } = validateRepo(root);
    assert.deepEqual(problems, [], `${root}\n${problems.join('\n')}`);
  }
});

test('validate: a broken run is reported, not ignored', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-broken-'));
  fs.cpSync(FIXTURES, root, { recursive: true });
  const runId = fs.readdirSync(path.join(root, 'results'))[0];
  const raw = path.join(root, 'results', runId, 'raw.jsonl');
  const lines = fs.readFileSync(raw, 'utf8').trim().split('\n');
  fs.writeFileSync(raw, [...lines, lines[0], '{not json'].join('\n') + '\n');
  const { problems } = validateRepo(root);
  assert.ok(problems.some((line) => /duplicate observation/.test(line)), problems.join('\n'));
  assert.ok(problems.some((line) => /invalid JSON|Unexpected|JSON/i.test(line)), problems.join('\n'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('validate: a completed run is counted against the suite version it recorded, not a newer one', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-grown-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(FIXTURES, root, { recursive: true });
  const runId = fs.readdirSync(path.join(root, 'results')).find((name) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'results', name, 'run.json'), 'utf8'));
    return manifest.status === 'completed' && !manifest.experiment?.cases?.length;
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'results', runId, 'run.json'), 'utf8'));
  const suiteDir = path.join(root, 'datasets', manifest.suite.id);
  const countProblem = (problems) => problems.filter((line) => line.includes(runId) && /completed run has/.test(line));
  // The suite grows a case and a new version: the stored run is still whole.
  const casesFile = path.join(suiteDir, 'cases.jsonl');
  const [first] = fs.readFileSync(casesFile, 'utf8').trim().split('\n');
  fs.appendFileSync(casesFile, `${JSON.stringify({ ...JSON.parse(first), case_id: `${manifest.suite.id}-grown` })}\n`);
  const suiteFile = path.join(suiteDir, 'suite.yaml');
  fs.writeFileSync(suiteFile, fs.readFileSync(suiteFile, 'utf8').replace(/^version: .*$/m, 'version: "99.0.0"'));
  assert.deepEqual(countProblem(validateRepo(root).problems), []);
  // At the version it recorded, a missing row is still reported.
  fs.writeFileSync(suiteFile, fs.readFileSync(suiteFile, 'utf8').replace(/^version: .*$/m, `version: "${manifest.suite.version}"`));
  fs.writeFileSync(casesFile, `${fs.readFileSync(casesFile, 'utf8').trim().split('\n').slice(0, -1).join('\n')}\n`);
  const raw = path.join(root, 'results', runId, 'raw.jsonl');
  fs.writeFileSync(raw, `${fs.readFileSync(raw, 'utf8').trim().split('\n').slice(1).join('\n')}\n`);
  assert.equal(countProblem(validateRepo(root).problems).length, 1);
});

test('state: fixture contexts, configurations and observations', () => {
  const state = buildState(FIXTURES);
  assert.deepEqual(state.problems, []);
  assert.equal(state.contexts.length, 3);
  assert.equal(Object.keys(state.configs).length, 6);
  assert.equal(state.runs.length, 9);
  assert.equal(state.observations.length, 77);
  const smoke = state.contexts.find((context) => context.suite.id === 'smoke' && context.repeats === 3);
  assert.ok(smoke, 'the 3-repeat smoke context exists');
  for (const id of smoke.config_ids) {
    const agg = smoke.aggregates[id];
    assert.ok(agg.n >= agg.ok_n && agg.ok_n >= agg.passed_n, id);
    if (agg.scored_n >= 3) assert.ok(agg.quality_ci, `${id} has a CI at n=${agg.scored_n}`);
    if (agg.pass_rate != null) assert.ok(agg.pass_rate_ci[0] <= agg.pass_rate && agg.pass_rate <= agg.pass_rate_ci[1], id);
  }
  const errors = state.observations.filter((item) => item.status === 'error');
  assert.ok(errors.length >= 1, 'the fixture timeout is an error observation');
  assert.ok(errors.every((item) => item.quality == null), 'an error is never scored as quality 0');
});
