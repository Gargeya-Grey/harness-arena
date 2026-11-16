import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as nodeTest from 'node:test';
import * as moduleApi from 'node:module';
import { getEvaluator } from '../lab/evaluators/index.mjs';
import { copyTree, snapshotWorkspace } from '../lab/lib/workspace.mjs';
import { loadSuite } from '../lab/lib/repo.mjs';

const repository = path.resolve(import.meta.dirname, '..');
const find = (directory, name) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.name === name) return file;
    if (entry.isDirectory()) { const nested = find(file, name); if (nested) return nested; }
  }
  return null;
};
const code = loadSuite(repository, 'ladder-code');
for (const testCase of code.cases) test(`repaired code evaluator accepts reference ${testCase.case_id}`, () => {
  const file = find(path.join(repository, 'tests/fixtures/ladder-code-solutions'), `${testCase.case_id}.mjs`);
  assert(file, testCase.case_id);
  const score = getEvaluator('js-function', '3').score({ raw: { response: { text: fs.readFileSync(file, 'utf8') } }, testCase });
  assert.equal(score.skip, undefined, JSON.stringify(score));
  assert.equal(score.value, 1, JSON.stringify(score));
  assert.equal(score.passed, true);
});

const agent = loadSuite(repository, 'ladder-agent');
for (const testCase of agent.cases) test(`repaired workspace evaluator accepts reference ${testCase.case_id}`, { skip: testCase.input.workspace === 'cart-discount' && (typeof moduleApi.registerHooks !== 'function' || typeof nodeTest.getTestContext !== 'function') ? 'executable call observation requires registerHooks and getTestContext' : false }, t => {
  const reference = find(path.join(repository, 'tests/fixtures/ladder-agent-solutions'), testCase.input.workspace);
  assert(reference, testCase.case_id);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-repaired-reference-'));
  const workspace = path.join(root, 'workspace');
  const runDir = path.join(root, 'run');
  const fixtureDir = path.join(agent.workspacesDir, testCase.input.workspace);
  fs.mkdirSync(runDir, { recursive: true });
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    const bytes = directory => fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? bytes(path.join(directory, entry.name)) : fs.statSync(path.join(directory, entry.name)).size), 0);
    const freed = bytes(root);
    fs.rmSync(root, { recursive: true, force: true });
    t.diagnostic(`Removed owned completed reference workspace; file-content bytes freed: ${freed}`);
  });
  copyTree(fixtureDir, workspace);
  copyTree(reference, workspace);
  const artifact = snapshotWorkspace({ fixtureDir, workDir: workspace, runDir, base: 'w', artifactId: 'reference', createdAt: '2026-11-16T00:00:00Z' });
  const score = getEvaluator('workspace-tests', '3').score({ raw: { response: { text: 'Reference.' }, artifacts: [artifact] }, testCase, suite: agent, runDir });
  assert.equal(score.skip, undefined, JSON.stringify(score));
  assert.equal(score.value, 1, JSON.stringify(score));
  assert.equal(score.passed, true);
});
