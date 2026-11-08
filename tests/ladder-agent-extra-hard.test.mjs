// The extra-hard agent tasks of the ladder (defs/extra-hard, tier 4) prove themselves: every
// starter fails its hidden check, every reference solution passes it, a plausible partial fix
// does not, the visible tests say what the issue says, and no starter file leaks a probe name
// or an expected value. All through the real workspace-tests@2 evaluator. No model calls.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCheck, runWorkspaceCheckV2 } from '../lab/evaluators/index.mjs';
import { copyTree, snapshotWorkspace } from '../lab/lib/workspace.mjs';
import { buildCases } from '../datasets/ladder-agent/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const SUITE = path.join(REPO, 'datasets', 'ladder-agent');
const SOLUTIONS = path.join(HERE, 'fixtures', 'ladder-agent-solutions', 'extra-hard');

// Slug -> tier level. The quota of this unit: 7 tasks, all tier 4, in 7 different domains.
const MINE = {
  'job-retry-queue': 4,
  'url-router': 4,
  'inventory-holds': 4,
  'access-policy': 4,
  'text-table': 4,
  'sla-timer': 4,
  'invoice-calc': 4,
};
const SLUGS = Object.keys(MINE);

const CASES = (await buildCases()).filter((item) => SLUGS.includes(item.input.workspace));

// Visible tests that fail on the starter because the issue is about them.
const STARTER_VISIBLE_FAILS = {
  'job-retry-queue': ['a job that always fails is dead after maxAttempts attempts', 'a job that fails once is retried and can still succeed'],
  'url-router': ['HEAD uses the GET handler', 'a static segment beats a parameter whatever the order of registration'],
  'inventory-holds': ['an expired hold stops keeping stock back', 'extend moves the end of a hold', 'the same id with other lines is a conflict'],
  'access-policy': ['a deny that was added after an allow still wins', 'an unknown user is denied', 'a double star matches any depth'],
  'text-table': [
    'a table without borders has no trailing spaces',
    'a new line in a cell makes more lines in the row',
    'a Hangul name takes two columns for each letter',
    'a centred cell puts the extra space on the right',
  ],
  'sla-timer': ['a duration used up exactly at the end of a window ends there', 'a paused clock has no deadline yet'],
  'invoice-calc': [
    'a quantity may have up to three decimals',
    'an invoice discount goes only to lines that can be discounted',
    'a split of 100 into three equal parts gives the extra unit to the first part',
    'money is written with the decimals of its currency',
  ],
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

const checksDir = path.join(SUITE, 'checks');
const fixtureOf = (slug) => path.join(SUITE, 'workspaces', slug);
const caseOf = (slug) => CASES.find((item) => item.input.workspace === slug);

/** The agent's workspace: the starter plus the files of an overlay folder. */
function workspaceWith(slug, overlay) {
  const work = path.join(tempDir('xhard-ws-'), 'work');
  copyTree(fixtureOf(slug), work);
  if (overlay) fs.cpSync(path.join(SOLUTIONS, overlay), work, { recursive: true });
  return work;
}

/** The real evaluator over one workspace, through the same snapshot and rebuild as a run. */
function check(slug, overlay) {
  const work = workspaceWith(slug, overlay);
  const runDir = tempDir('xhard-run-');
  const artifact = snapshotWorkspace({ fixtureDir: fixtureOf(slug), workDir: work, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-07T00:00:00Z' });
  const run = runWorkspaceCheckV2({ fixtureDir: fixtureOf(slug), check: loadCheck(checksDir, slug), runDir, manifestPath: artifact.path });
  assert.equal(run.error, undefined, `${slug}: the check itself broke: ${run.error}`);
  return run.results;
}

const failed = (results) => results.filter((item) => !item.ok);
const passedCount = (results) => results.filter((item) => item.ok).length;
// A probe that must hold on the starter too, and a file rule that only guards the tests.
const isRegression = (item) => item.name.startsWith('keeps') || item.name.startsWith('file ');
const guardsOnly = (slug, item) => item.name.startsWith('keeps') || (item.name.startsWith('file ') && loadCheck(checksDir, slug).files[item.name.slice(5)]?.same_as_starter === true);

function visibleTests(dir) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // else the child reports to this test run instead of printing
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: dir, encoding: 'utf8', timeout: 60_000, windowsHide: true, env });
  const lines = String(run.stdout).split('\n');
  const count = (label) => Number((lines.find((line) => line.startsWith(`# ${label} `)) || '').split(' ')[2]);
  return { pass: count('pass'), fail: count('fail'), failing: lines.filter((line) => line.startsWith('not ok')).map((line) => line.replace(/^not ok \d+ - /, '')) };
}

const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

test('the unit holds its quota: 7 tasks, all tier 4, with a time inside the tier', () => {
  assert.equal(CASES.length, 7);
  for (const slug of SLUGS) {
    const item = caseOf(slug);
    assert.equal(item.metadata.tier.level, 4, slug);
    assert.ok(item.metadata.tier.human_minutes > 30 && item.metadata.tier.human_minutes <= 120, `${slug}: ${item.metadata.tier.human_minutes} minutes`);
  }
});

test('every case states an honest basis and a task that says what to do with the tests', () => {
  for (const item of CASES) {
    const slug = item.input.workspace;
    assert.equal(item.case_id, `ladder-agent-${slug}`);
    assert.equal(item.expected.check, slug);
    assert.ok(item.metadata.tier.basis.length >= 80, `${slug}: basis is too short`);
    assert.match(item.metadata.tier.basis, /estimate|not a timed solve/i, `${slug}: the basis does not say it is an estimate`);
    assert.match(item.input.task, /must not be edited/, `${slug}: the task does not say that the tests must not be edited`);
    assert.match(item.input.task, /The rules we agreed on:/, `${slug}: the task has no rules`);
  }
});

test('every starter is a multi-file project of 10 to 20 source files with visible tests and 20 to 35 probes', () => {
  for (const slug of SLUGS) {
    const files = fs.readdirSync(path.join(fixtureOf(slug), 'src'));
    assert.ok(files.length >= 10 && files.length <= 20, `${slug}: ${files.length} source files, want 10 to 20`);
    assert.ok(fs.readdirSync(path.join(fixtureOf(slug), 'test')).length >= 2, `${slug}: too few test files`);
    const count = Object.keys(loadCheck(checksDir, slug).probes).length;
    assert.ok(count >= 20 && count <= 35, `${slug}: ${count} probes, want 20 to 35`);
    assert.ok(fs.existsSync(path.join(checksDir, slug, 'expected.json')));
  }
});

test('every project has no dependencies: only relative and node: imports', () => {
  for (const slug of SLUGS) {
    const manifest = JSON.parse(fs.readFileSync(path.join(fixtureOf(slug), 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies, undefined, slug);
    assert.equal(manifest.devDependencies, undefined, slug);
    for (const file of listFiles(fixtureOf(slug)).filter((item) => item.endsWith('.mjs'))) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
        assert.ok(match[1].startsWith('.') || match[1].startsWith('node:'), `${slug}: ${path.relative(SUITE, file)} imports ${match[1]}`);
      }
    }
  }
});

test('the seven tasks are in seven different domains and none repeats a domain of another unit', () => {
  assert.equal(new Set(SLUGS).size, 7);
  const taken = ['ledger-fx', 'csv-report', 'pkg-resolver', 'rate-limiter', 'template-escape', 'ttl-size-cache'];
  for (const slug of SLUGS) assert.ok(!taken.includes(slug), slug);
  // Every project has its own source file names for its main module.
  const mains = SLUGS.map((slug) => fs.readdirSync(path.join(fixtureOf(slug), 'src')).sort().join(','));
  assert.equal(new Set(mains).size, 7);
});

test('every starter fails its check, and the guard probes and file rules pass on it', () => {
  for (const slug of SLUGS) {
    const results = check(slug, null);
    assert.ok(failed(results).length > 0, `${slug}: the starter passes its own check`);
    for (const item of results) if (guardsOnly(slug, item)) assert.ok(item.ok, `${slug}: "${item.name}" must pass on the starter (${item.error})`);
  }
});

test('every starter fails every probe the issue is about, and keeps a regression probe', () => {
  for (const slug of SLUGS) {
    const results = check(slug, null);
    for (const item of results) {
      if (!isRegression(item)) assert.ok(!item.ok, `${slug}: "${item.name}" passes on the starter, so it does not test the issue`);
    }
    assert.ok(results.some((item) => item.name.startsWith('keeps')), `${slug}: no regression probe`);
  }
});

test('every reference solution passes every probe and file rule', () => {
  for (const slug of SLUGS) {
    const results = check(slug, slug);
    assert.deepEqual(failed(results).map((item) => `${item.name}: ${item.error}`), [], slug);
    const want = Object.keys(loadCheck(checksDir, slug).probes).length;
    assert.ok(results.length >= want, `${slug}: only ${results.length} checks`);
    assert.ok(results.length >= 22, `${slug}: only ${results.length} checks`);
  }
});

test('a plausible partial fix still fails the check, but is better than the starter', () => {
  for (const slug of SLUGS) {
    const partial = check(slug, `${slug}--partial`);
    const starter = check(slug, null);
    assert.ok(failed(partial).length >= 3, `${slug}: the partial fix fails only ${failed(partial).length} checks`);
    assert.ok(passedCount(partial) > passedCount(starter), `${slug}: the partial fix is no better than the starter`);
    assert.ok(passedCount(partial) < partial.length, `${slug}: the partial fix passes everything`);
    for (const item of partial) if (isRegression(item)) assert.ok(item.ok, `${slug}: the partial fix broke "${item.name}"`);
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
      assert.ok(fs.existsSync(path.join(SOLUTIONS, overlay)), `${overlay}: missing overlay folder`);
      const result = visibleTests(workspaceWith(slug, overlay));
      assert.deepEqual(result.failing, [], overlay);
      assert.equal(result.fail, 0, overlay);
      assert.ok(result.pass >= 8, overlay);
    }
  }
});

test('every overlay only adds or changes files under src: no test is touched', () => {
  for (const slug of SLUGS) {
    for (const overlay of [slug, `${slug}--partial`]) {
      for (const file of listFiles(path.join(SOLUTIONS, overlay))) {
        const relative = path.relative(path.join(SOLUTIONS, overlay), file).split(path.sep);
        assert.equal(relative[0], 'src', `${overlay}: ${relative.join('/')} is outside src`);
      }
    }
  }
});

test('no starter file contains a probe name or an expected value', () => {
  for (const slug of SLUGS) {
    const { probes } = loadCheck(checksDir, slug);
    // For a task a probe name is also a needle; a short name such as "digits" is not.
    const needles = new Set(Object.keys(probes).filter((name) => !name.startsWith('keeps') && name.length >= 12));
    const task = caseOf(slug).input.task;
    const walk = (value) => {
      // A name the issue itself states (ConflictError, a header) is not hidden.
      if (typeof value === 'string' && value.length >= 12 && !task.includes(value)) needles.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    Object.entries(probes).forEach(([name, value]) => !name.startsWith('keeps') && walk(value));
    const files = listFiles(fixtureOf(slug));
    assert.ok(files.length >= 3);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const needle of needles) assert.ok(!text.includes(needle), `${slug}: ${path.relative(SUITE, file)} contains ${JSON.stringify(needle).slice(0, 80)}`);
    }
    for (const name of Object.keys(probes).filter((item) => item.length >= 12)) assert.ok(!task.includes(name), `${slug}: the task text contains the probe name "${name}"`);
  }
});

test('the starters, checks and solutions leak no home path or tool setup, and no old suite name', () => {
  const bad = /Users[\\/]|AppData|\.claude|C:\\|\/home\//;
  const roots = [SOLUTIONS, ...SLUGS.flatMap((slug) => [fixtureOf(slug), path.join(checksDir, slug)]), path.join(SUITE, 'defs', 'extra-hard')];
  for (const root of roots) {
    for (const file of listFiles(root)) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!bad.test(text), `${path.relative(REPO, file)} names a home path`);
      assert.ok(!/datasets[\\/]agentic/.test(text), `${path.relative(REPO, file)} points at an old suite`);
    }
  }
});
