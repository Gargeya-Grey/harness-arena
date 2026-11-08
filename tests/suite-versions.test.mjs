// Frozen suite versions (datasets/<suite>/versions/<version>/): a new suite version never
// changes how an older run is scored, counted or shown.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newCase } from '../lab/commands/new-case.mjs';
import { scoreRun } from '../lab/commands/score.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { readJson } from '../lab/lib/fsutil.mjs';
import { freezeSuite, frozenVersions, loadCases, loadSuite } from '../lab/lib/repo.mjs';
import { buildState } from '../lab/lib/state.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// A committed run of reasoning 1.0.0; the archived suite is now at 1.1.0.
const RUN = '20261104T161946Z__reasoning__reasoning-sweep__e79a4d';
const SMOKE_RUN = '20261021T080428Z__smoke__smoke-command-code__900ca7';

function tempRoot(t, runs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-versions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  for (const dir of ['configs', 'datasets', 'prompts', 'experiments']) fs.cpSync(path.join(REPO, dir), path.join(root, dir), { recursive: true });
  for (const run of runs) fs.cpSync(path.join(REPO, 'results', run), path.join(root, 'results', run), { recursive: true });
  return root;
}

const suiteFolder = (root) => path.join(root, 'datasets', 'archive', 'reasoning');
const copyFolder = (root, version = '1.0.0') => path.join(suiteFolder(root), 'versions', version);
const scoresBytes = (root) => fs.readFileSync(path.join(root, 'results', RUN, 'scores', 'final-answer@1.jsonl'));

test('a run of an earlier version loads that version from its frozen copy, with the hash the run recorded', (t) => {
  const root = tempRoot(t, [RUN]);
  const manifest = readJson(path.join(root, 'results', RUN, 'run.json'));
  assert.equal(manifest.suite.version, '1.0.0');
  assert.equal(loadSuite(root, 'reasoning').version, '1.1.0');
  assert.deepEqual(frozenVersions(suiteFolder(root)), ['1.0.0']);
  const copy = loadSuite(root, 'reasoning', { version: '1.0.0' });
  assert.equal(copy.frozen, true);
  assert.equal(copy.version, '1.0.0');
  assert.equal(copy.sha256, manifest.suite.sha256);
  assert.equal(loadSuite(root, 'reasoning', { version: '1.1.0' }).frozen, false, 'the current version is the folder itself');
  assert.equal(loadSuite(root, 'reasoning', { version: '9.9.9' }), null);
  assert.equal(loadSuite(root, 'reasoning', { version: '../1.0.0' }), null, 'a version is a name, never a path');
});

test('score uses the frozen copy and gives the scores the run already holds', (t) => {
  const root = tempRoot(t, [RUN]);
  const before = scoresBytes(root);
  const written = scoreRun(root, path.join(root, 'results', RUN));
  assert.deepEqual(written.map((item) => item.rel), ['scores/final-answer@1.jsonl']);
  assert.deepEqual(scoresBytes(root), before);
});

test('score refuses a run whose version has no frozen copy, and leaves its scores as they are', (t) => {
  const root = tempRoot(t, [RUN]);
  fs.rmSync(copyFolder(root), { recursive: true });
  const before = scoresBytes(root);
  const lines = [];
  assert.deepEqual(scoreRun(root, path.join(root, 'results', RUN), { log: (line) => lines.push(line) }), []);
  assert.match(lines.join('\n'), /no longer at version 1\.0\.0, and datasets\/archive\/reasoning\/versions\/1\.0\.0\/ holds no frozen copy/);
  assert.deepEqual(scoresBytes(root), before);
  const { problems, warnings } = validateRepo(root);
  assert.deepEqual(problems, []);
  assert.ok(warnings.some((line) => line.includes(RUN) && /no frozen copy in datasets\/archive\/reasoning\/versions\/1\.0\.0\/, so this run cannot be scored again/.test(line)), warnings.join('\n'));
});

test('score refuses a frozen copy that is not the content the run used; validate reports it', (t) => {
  const root = tempRoot(t, [RUN]);
  const cases = path.join(copyFolder(root), 'cases.jsonl');
  const lines = fs.readFileSync(cases, 'utf8').split('\n');
  fs.writeFileSync(cases, lines.slice(1).join('\n'));
  const before = scoresBytes(root);
  const log = [];
  assert.deepEqual(scoreRun(root, path.join(root, 'results', RUN), { log: (line) => log.push(line) }), []);
  assert.match(log.join('\n'), /reasoning 1\.0\.0 \(frozen copy\) is not the content this run used/);
  assert.deepEqual(scoresBytes(root), before);
  assert.ok(validateRepo(root).problems.some((line) => /the frozen copy of suite reasoning 1\.0\.0 is not the content this run used/.test(line)));
});

test('validate reports a suite changed after a run without a version bump', (t) => {
  const root = tempRoot(t, [SMOKE_RUN]);
  assert.deepEqual(validateRepo(root).problems, []);
  fs.appendFileSync(path.join(root, 'datasets', 'smoke', 'suite.yaml'), '# edited\n');
  const { problems } = validateRepo(root);
  assert.ok(problems.some((line) => line.includes(SMOKE_RUN) && /suite smoke 0\.1\.0 changed after this run .*bump its version and freeze 0\.1\.0/.test(line)), problems.join('\n'));
});

test('the state keeps a case that only the run\'s version has, with its text from the frozen copy', (t) => {
  const root = tempRoot(t, [RUN]);
  // A new current version without the case the run answered.
  const dir = suiteFolder(root);
  const dropped = 'reasoning-bat-ball';
  const current = fs.readFileSync(path.join(dir, 'cases.jsonl'), 'utf8').split('\n').filter((line) => line && !line.includes(`"case_id":"${dropped}"`));
  fs.writeFileSync(path.join(dir, 'cases.jsonl'), current.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'suite.yaml'), fs.readFileSync(path.join(dir, 'suite.yaml'), 'utf8').replace(/^version: .*$/m, 'version: "2.0.0"'));
  assert.ok(!loadCases(root, 'reasoning').some((item) => item.case_id === dropped));
  const old = loadCases(root, 'reasoning', '1.0.0').find((item) => item.case_id === dropped);
  assert.ok(old);

  const state = buildState(root, { validate: false });
  assert.deepEqual(state.cases[dropped].input, old.input);
  assert.equal(state.cases[dropped].suite, 'reasoning');
  const rows = state.observations.filter((item) => item.case_id === dropped);
  assert.ok(rows.length > 0 && rows.every((item) => item.quality != null), 'its scores still count');
});

test('a context of an older version carries its own text of a case that changed, and the current text stays shared', (t) => {
  const root = tempRoot(t, [RUN]);
  const dir = suiteFolder(root);
  const id = 'reasoning-bat-ball';
  const old = loadCases(root, 'reasoning', '1.0.0').find((item) => item.case_id === id);
  const lines = fs.readFileSync(path.join(dir, 'cases.jsonl'), 'utf8').split('\n').map((line) => (line.includes(`"case_id":"${id}"`) ? JSON.stringify({ ...JSON.parse(line), input: { question: 'A new question?' } }) : line));
  fs.writeFileSync(path.join(dir, 'cases.jsonl'), lines.join('\n'));
  const state = buildState(root, { validate: false });
  assert.equal(state.cases[id].input.question, 'A new question?', 'the shared entry is the suite now');
  const context = state.contexts.find((item) => item.suite.version === '1.0.0');
  assert.deepEqual(context.case_data[id].input, old.input, 'the 1.0.0 test shows the question its run answered');
  assert.ok(!('reasoning-clock-angle' in context.case_data), 'an unchanged case is not repeated');
});

test('freezeSuite copies the current version with its parts, is safe to repeat, and refuses a copy that differs', (t) => {
  const root = tempRoot(t, []);
  const agentic = loadSuite(root, 'agentic');
  const frozen = freezeSuite(root, 'agentic');
  assert.deepEqual([frozen.created, frozen.version], [true, agentic.version]);
  assert.ok(fs.existsSync(path.join(frozen.dir, 'workspaces')) && fs.existsSync(path.join(frozen.dir, 'checks')), 'a copy is complete');
  assert.equal(freezeSuite(root, 'agentic').created, false);
  // After the bump, the copy loads as the old version with the old hash, and later changes to the
  // current checks do not reach it.
  const yaml = path.join(agentic.dir, 'suite.yaml');
  fs.writeFileSync(yaml, fs.readFileSync(yaml, 'utf8').replace(/^version: .*$/m, 'version: "9.0.0"'));
  const check = fs.readdirSync(path.join(agentic.dir, 'checks'))[0];
  fs.appendFileSync(path.join(agentic.dir, 'checks', check, 'expected.json'), '\n');
  const copy = loadSuite(root, 'agentic', { version: agentic.version });
  assert.deepEqual([copy.frozen, copy.sha256], [true, agentic.sha256]);
  assert.equal(copy.checksDir, path.join(frozen.dir, 'checks'));
  // A copy that is not the suite's content is refused.
  const smoke = loadSuite(root, 'smoke');
  fs.mkdirSync(path.join(smoke.dir, 'versions', smoke.version), { recursive: true });
  fs.writeFileSync(path.join(smoke.dir, 'versions', smoke.version, 'suite.yaml'), 'id: smoke\n');
  fs.writeFileSync(path.join(smoke.dir, 'versions', smoke.version, 'cases.jsonl'), '');
  assert.throws(() => freezeSuite(root, 'smoke'), /exists and is not the current content of smoke/);
});

test('freezeSuite leaves out what the hash leaves out, and no temporary folder stays', (t) => {
  const root = tempRoot(t, []);
  const suite = loadSuite(root, 'agentic');
  const starter = fs.readdirSync(suite.workspacesDir)[0];
  fs.mkdirSync(path.join(suite.workspacesDir, starter, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(suite.workspacesDir, starter, 'node_modules', 'dep', 'index.js'), 'x');
  const frozen = freezeSuite(root, 'agentic');
  assert.ok(!fs.existsSync(path.join(frozen.dir, 'workspaces', starter, 'node_modules')));
  assert.deepEqual(fs.readdirSync(suite.dir).filter((name) => name.startsWith('.freeze-')), []);
  assert.deepEqual(fs.readdirSync(path.join(suite.dir, 'versions')).filter((name) => name.includes('tmp')), []);
});

test('the state does not show the cases of a frozen copy that is not the content the run used', (t) => {
  const root = tempRoot(t, [RUN]);
  const cases = path.join(copyFolder(root), 'cases.jsonl');
  const edited = fs.readFileSync(cases, 'utf8').replace(/"question":"[^"]*"/, '"question":"An edited question?"');
  fs.writeFileSync(cases, edited);
  const state = buildState(root, { validate: false });
  const context = state.contexts.find((item) => item.suite.version === '1.0.0');
  assert.deepEqual(context.case_data, {});
  assert.ok(!JSON.stringify(state.cases).includes('An edited question?'));
  assert.ok(state.problems.some((item) => /the frozen copy of suite reasoning 1\.0\.0 is not the content its runs used/.test(JSON.stringify(item))), JSON.stringify(state.problems));
});

test('new-case freezes the old version before it adds the case and bumps the version', (t) => {
  const root = tempRoot(t, [SMOKE_RUN]);
  const before = loadSuite(root, 'smoke');
  newCase(root, 'smoke', 'frozen-probe', { log: () => {} });
  const after = loadSuite(root, 'smoke');
  assert.notEqual(after.version, before.version);
  const copy = loadSuite(root, 'smoke', { version: before.version });
  assert.deepEqual([copy.frozen, copy.sha256], [true, before.sha256]);
  const lines = [];
  assert.equal(scoreRun(root, path.join(root, 'results', SMOKE_RUN), { log: (line) => lines.push(line) }).length > 0, true, lines.join('\n'));
});

test('validate checks every frozen copy: folder names, the current version, missing files, id and version', (t) => {
  const root = tempRoot(t, [RUN]);
  const versions = path.join(suiteFolder(root), 'versions');
  assert.deepEqual(validateRepo(root).problems, []);
  fs.writeFileSync(path.join(versions, 'notes.txt'), 'x');
  fs.cpSync(copyFolder(root), copyFolder(root, '1.1.0'), { recursive: true });
  fs.mkdirSync(copyFolder(root, '0.9.0'));
  fs.cpSync(copyFolder(root), copyFolder(root, '0.7.0'), { recursive: true });
  fs.rmSync(path.join(copyFolder(root, '0.7.0'), 'cases.jsonl'));
  fs.cpSync(copyFolder(root), copyFolder(root, '0.8.0'), { recursive: true });
  const file = path.join(copyFolder(root, '0.8.0'), 'suite.yaml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^id: .*$/m, 'id: other'));
  const { problems } = validateRepo(root);
  const has = (pattern) => assert.ok(problems.some((line) => pattern.test(line)), `${pattern}\n${problems.join('\n')}`);
  has(/versions[\\/]notes\.txt: versions\/ holds only folders named by a version/);
  has(/versions[\\/]1\.1\.0: version 1\.1\.0 is the current version of reasoning/);
  has(/versions[\\/]0\.9\.0: a frozen copy needs suite\.yaml and cases\.jsonl/);
  has(/versions[\\/]0\.7\.0: a frozen copy needs suite\.yaml and cases\.jsonl/);
  has(/versions[\\/]0\.8\.0[\\/]suite\.yaml: id "other" is not "reasoning"/);
  has(/versions[\\/]0\.8\.0[\\/]suite\.yaml: version 1\.0\.0 does not match the folder name 0\.8\.0/);
});
