// The agentic-hard suite proves itself: every starter fails its hidden check, every
// reference solution passes it, a plausible partial fix does not, the visible tests
// say what the issue says, and no starter file leaks a probe name or an expected
// value. All through the real workspace-tests evaluator. No model calls.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCheck, runWorkspaceCheck } from '../lab/evaluators/index.mjs';
import { copyTree, snapshotWorkspace } from '../lab/lib/workspace.mjs';
import { readJsonl } from '../lab/lib/fsutil.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const SUITE = path.join(REPO, 'datasets', 'agentic-hard');
const SOLUTIONS = path.join(HERE, 'fixtures', 'agentic-hard-solutions');
const { rows: CASES, problems } = readJsonl(path.join(SUITE, 'cases.jsonl'));
assert.deepEqual(problems, []);
const SLUGS = CASES.map((item) => item.input.workspace);

// Visible tests that fail on the starter because the issue is about them.
const STARTER_VISIBLE_FAILS = {
  'csv-report': ['a quoted field may hold a comma'],
  'ledger-fx': [],
  'pkg-resolver': ['the error names the whole cycle, starting and ending at the same package'],
  'rate-limiter': ['one token comes back every second at one per second', 'a client that polls faster than the refill interval still gets its turn'],
  'template-escape': [],
  'ttl-size-cache': ['a number is a time to live in milliseconds', 'text with a unit is converted to milliseconds'],
};

const temps = [];
test.after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

const fixtureOf = (slug) => path.join(SUITE, 'workspaces', slug);

/** The agent's workspace: the starter plus the files of an overlay folder. */
function workspaceWith(slug, overlay) {
  const work = path.join(tempDir('hard-ws-'), 'work');
  copyTree(fixtureOf(slug), work);
  if (overlay) fs.cpSync(path.join(SOLUTIONS, overlay), work, { recursive: true });
  return work;
}

/** The real evaluator over one workspace, through the same snapshot and rebuild as a run. */
function check(slug, overlay) {
  const work = workspaceWith(slug, overlay);
  const runDir = tempDir('hard-run-');
  const artifact = snapshotWorkspace({ fixtureDir: fixtureOf(slug), workDir: work, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-05T00:00:00Z' });
  const run = runWorkspaceCheck({ fixtureDir: fixtureOf(slug), check: loadCheck(path.join(SUITE, 'checks'), slug), runDir, manifestPath: artifact.path });
  assert.equal(run.error, undefined, `${slug}: the check itself broke: ${run.error}`);
  return run.results;
}

const failed = (results) => results.filter((item) => !item.ok);
const passedCount = (results) => results.filter((item) => item.ok).length;

function visibleTests(dir) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // else the child reports to this test run instead of printing
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: dir, encoding: 'utf8', timeout: 60_000, windowsHide: true, env });
  const lines = String(run.stdout).split('\n');
  const count = (label) => Number((lines.find((line) => line.startsWith(`# ${label} `)) || '').split(' ')[2]);
  return { pass: count('pass'), fail: count('fail'), failing: lines.filter((line) => line.startsWith('not ok')).map((line) => line.replace(/^not ok \d+ - /, '')) };
}

test('the suite declares six hard cases with a starter and a check each', () => {
  const suite = fs.readFileSync(path.join(SUITE, 'suite.yaml'), 'utf8');
  assert.match(suite, /^id: agentic-hard$/m);
  assert.match(suite, /^version: "1\.0\.0"$/m);
  assert.deepEqual([...SLUGS].sort(), Object.keys(STARTER_VISIBLE_FAILS).sort());
  const seen = new Set();
  for (const item of CASES) {
    assert.match(item.case_id, /^agentic-hard-[a-z0-9-]+$/);
    assert.ok(!seen.has(item.case_id), `duplicate ${item.case_id}`);
    seen.add(item.case_id);
    assert.equal(item.case_id, `agentic-hard-${item.input.workspace}`);
    assert.equal(item.expected.check, item.input.workspace);
    assert.equal(item.tags.length, 2);
    assert.equal(item.tags[1], 'hard');
    assert.ok(fs.statSync(fixtureOf(item.input.workspace)).isDirectory());
    assert.ok(fs.existsSync(path.join(SUITE, 'checks', item.expected.check, 'probe.mjs')));
    assert.match(item.input.task, /must not be edited/);
    const { probes } = loadCheck(path.join(SUITE, 'checks'), item.expected.check);
    const count = Object.keys(probes).length;
    assert.ok(count >= 20 && count <= 25, `${item.case_id}: ${count} probes, want 20 to 25`);
  }
});

test('every starter is a multi-file project with visible tests', () => {
  for (const slug of SLUGS) {
    const files = fs.readdirSync(path.join(fixtureOf(slug), 'src'));
    assert.ok(files.length >= 7, `${slug}: only ${files.length} source files`);
    assert.ok(fs.readdirSync(path.join(fixtureOf(slug), 'test')).length >= 2, `${slug}: too few test files`);
  }
});

test('every starter fails its check, and fails every probe the issue is about', () => {
  for (const slug of SLUGS) {
    const results = check(slug, null);
    assert.ok(failed(results).length > 0, `${slug}: the starter passes its own check`);
    for (const item of results) {
      if (item.name.startsWith('keeps') || item.name.startsWith('file ')) assert.ok(item.ok, `${slug}: "${item.name}" must pass on the starter (${item.error})`);
      else assert.ok(!item.ok, `${slug}: "${item.name}" passes on the starter, so it does not test the issue`);
    }
    assert.ok(results.some((item) => item.name.startsWith('keeps')), `${slug}: no regression probe`);
  }
});

test('every reference solution passes every probe and file rule', () => {
  for (const slug of SLUGS) {
    const results = check(slug, slug);
    assert.deepEqual(failed(results).map((item) => `${item.name}: ${item.error}`), [], slug);
    assert.ok(results.length >= 22, `${slug}: only ${results.length} checks`);
  }
});

test('a plausible partial fix still fails the check, but is better than the starter', () => {
  for (const slug of SLUGS) {
    const partial = check(slug, `${slug}--partial`);
    const starter = check(slug, null);
    assert.ok(failed(partial).length >= 3, `${slug}: the partial fix fails only ${failed(partial).length} checks`);
    assert.ok(passedCount(partial) > passedCount(starter), `${slug}: the partial fix is no better than the starter`);
    for (const item of partial) if (item.name.startsWith('keeps') || item.name.startsWith('file ')) assert.ok(item.ok, `${slug}: the partial fix broke "${item.name}"`);
  }
});

test('the visible tests of each starter say what the issue says', () => {
  for (const slug of SLUGS) {
    const starter = visibleTests(fixtureOf(slug));
    assert.deepEqual(starter.failing, STARTER_VISIBLE_FAILS[slug], `${slug}: visible failures on the starter`);
    assert.equal(starter.fail, STARTER_VISIBLE_FAILS[slug].length);
    assert.ok(starter.pass >= 8, `${slug}: only ${starter.pass} visible tests pass`);
  }
});

test('the visible tests all pass on every reference solution and every partial fix', () => {
  for (const slug of SLUGS) {
    for (const overlay of [slug, `${slug}--partial`]) {
      const result = visibleTests(workspaceWith(slug, overlay));
      assert.deepEqual(result.failing, [], overlay);
      assert.equal(result.fail, 0, overlay);
    }
  }
});

test('no starter file contains a probe name or an expected value', () => {
  for (const slug of SLUGS) {
    const { probes } = loadCheck(path.join(SUITE, 'checks'), slug);
    const needles = new Set(Object.keys(probes).filter((name) => !name.startsWith('keeps')));
    const task = CASES.find((item) => item.input.workspace === slug).input.task;
    const walk = (value) => {
      // A name the issue itself states (ConflictError, a header) is not hidden.
      if (typeof value === 'string' && value.length >= 12 && !task.includes(value)) needles.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    Object.entries(probes).forEach(([name, value]) => !name.startsWith('keeps') && walk(value));
    const files = [];
    const list = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) list(path.join(dir, entry.name));
        else files.push(path.join(dir, entry.name));
      }
    };
    list(fixtureOf(slug));
    assert.ok(files.length >= 10);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const needle of needles) assert.ok(!text.includes(needle), `${slug}: ${path.relative(SUITE, file)} contains ${JSON.stringify(needle).slice(0, 80)}`);
    }
    for (const name of Object.keys(probes)) assert.ok(!task.includes(name), `${slug}: the task text contains the probe name "${name}"`);
  }
});

test('the starters leak no home path or tool setup', () => {
  const bad = /Users[\\/]|AppData|\.claude|C:\\|\/home\//;
  const list = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? list(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  for (const root of [SUITE, SOLUTIONS]) {
    for (const file of list(root)) assert.ok(!bad.test(fs.readFileSync(file, 'utf8')), `${path.relative(REPO, file)} names a home path`);
  }
});
