// The folded agent tasks of the ladder (defs/core) prove themselves: every starter
// fails its hidden check, every reference solution passes it, a plausible partial
// fix does not, the visible tests say what the issue says, and no starter file leaks
// a probe name or an expected value. All through the real workspace-tests
// evaluator. No model calls. Ports tests/agentic.test.mjs and tests/agentic-hard.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCheck, runWorkspaceCheck } from '../lab/evaluators/index.mjs';
import { copyTree, snapshotWorkspace } from '../lab/lib/workspace.mjs';
import { buildCases } from '../datasets/ladder-agent/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const SUITE = path.join(REPO, 'datasets', 'ladder-agent');
const SOLUTIONS = path.join(HERE, 'fixtures', 'ladder-agent-solutions', 'core');

// Slug -> tier level. The quota of this unit: 1 easy, 3 medium, 5 hard.
const MINE = {
  'slugify-bug': 1,
  'cart-discount': 2,
  'pagination-bug': 2,
  'booking-overlap': 2,
  'ledger-fx': 3,
  'template-escape': 3,
  'ttl-size-cache': 3,
  'csv-report': 3,
  'rate-limiter': 3,
};
const SLUGS = Object.keys(MINE);
const HARD = SLUGS.filter((slug) => MINE[slug] === 3);

// Old suite names, for the "origin" of each case.
const ORIGIN = (slug) => (HARD.includes(slug) ? `agentic-hard-${slug}` : `agentic-${slug}`);

const CASES = (await buildCases()).filter((item) => SLUGS.includes(item.input.workspace));

// Visible tests that fail on the starter because the issue is about them.
const STARTER_VISIBLE_FAILS = {
  'slugify-bug': ['drops punctuation and extra spaces'],
  'cart-discount': [],
  'pagination-bug': ['page 1 holds the first items', 'the last page holds the rest', 'pages counts a partly filled last page'],
  'booking-overlap': ['a stay that ends the day another one starts does not overlap it', 'nights counts the nights of a stay'],
  'ledger-fx': [],
  'rate-limiter': ['one token comes back every second at one per second', 'a client that polls faster than the refill interval still gets its turn'],
  'template-escape': [],
  'ttl-size-cache': ['a number is a time to live in milliseconds', 'text with a unit is converted to milliseconds'],
  'csv-report': ['a quoted field may hold a comma'],
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
const caseOf = (slug) => CASES.find((item) => item.input.workspace === slug);

/** The agent's workspace: the starter plus the files of an overlay folder. */
function workspaceWith(slug, overlay) {
  const work = path.join(tempDir('core-ws-'), 'work');
  copyTree(fixtureOf(slug), work);
  if (overlay) fs.cpSync(path.join(SOLUTIONS, overlay), work, { recursive: true });
  return work;
}

/** The real evaluator over one workspace, through the same snapshot and rebuild as a run. */
function check(slug, overlay) {
  return checkWork(slug, workspaceWith(slug, overlay));
}

function checkWork(slug, work) {
  const runDir = tempDir('core-run-');
  const artifact = snapshotWorkspace({ fixtureDir: fixtureOf(slug), workDir: work, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-07T00:00:00Z' });
  const run = runWorkspaceCheck({ fixtureDir: fixtureOf(slug), check: loadCheck(path.join(SUITE, 'checks'), slug), runDir, manifestPath: artifact.path });
  assert.equal(run.error, undefined, `${slug}: the check itself broke: ${run.error}`);
  return run.results;
}

const failed = (results) => results.filter((item) => !item.ok);
const passedCount = (results) => results.filter((item) => item.ok).length;
// A probe that must hold on the starter too, and a file rule that only guards the tests.
const isRegression = (item) => item.name.startsWith('keeps') || item.name.startsWith('file ');
const guardsOnly = (slug, item) => item.name.startsWith('keeps') || (item.name.startsWith('file ') && loadCheck(path.join(SUITE, 'checks'), slug).files[item.name.slice(5)]?.same_as_starter === true);

function visibleTests(dir) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // else the child reports to this test run instead of printing
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: dir, encoding: 'utf8', timeout: 60_000, windowsHide: true, env });
  const lines = String(run.stdout).split('\n');
  const count = (label) => Number((lines.find((line) => line.startsWith(`# ${label} `)) || '').split(' ')[2]);
  return { pass: count('pass'), fail: count('fail'), failing: lines.filter((line) => line.startsWith('not ok')).map((line) => line.replace(/^not ok \d+ - /, '')) };
}

const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

test('the unit holds its quota per tier: 1 easy, 3 medium, 5 hard', () => {
  assert.equal(CASES.length, 9);
  const perTier = (level) => CASES.filter((item) => item.metadata.tier.level === level).length;
  assert.deepEqual([perTier(1), perTier(2), perTier(3)], [1, 3, 5]);
  for (const slug of SLUGS) assert.equal(caseOf(slug).metadata.tier.level, MINE[slug], slug);
});

test('every case records its origin, an honest time inside its tier, and a task that states the rules', () => {
  for (const item of CASES) {
    const slug = item.input.workspace;
    assert.equal(item.case_id, `ladder-agent-${slug}`);
    assert.equal(item.expected.check, slug);
    assert.equal(item.metadata.tier.origin, ORIGIN(slug));
    assert.ok(item.metadata.tier.basis.length >= 40, `${slug}: basis is too short`);
    assert.ok(fs.statSync(fixtureOf(slug)).isDirectory());
    assert.ok(fs.existsSync(path.join(SUITE, 'checks', slug, 'probe.mjs')));
    assert.match(item.input.task, /Do not change the tests|must not be edited|Keep the existing tests passing|add tests|Add test/i, `${slug}: the task does not say what to do with the tests`);
  }
});

test('every hard starter is a multi-file project with visible tests, and 20 to 25 probes', () => {
  for (const slug of HARD) {
    const files = fs.readdirSync(path.join(fixtureOf(slug), 'src'));
    assert.ok(files.length >= 7, `${slug}: only ${files.length} source files`);
    assert.ok(fs.readdirSync(path.join(fixtureOf(slug), 'test')).length >= 2, `${slug}: too few test files`);
    const count = Object.keys(loadCheck(path.join(SUITE, 'checks'), slug).probes).length;
    assert.ok(count >= 20 && count <= 25, `${slug}: ${count} probes, want 20 to 25`);
    assert.match(caseOf(slug).input.task, /must not be edited/);
  }
});

test('every starter fails its check', () => {
  for (const slug of SLUGS) {
    const results = check(slug, null);
    assert.ok(failed(results).length > 0, `${slug}: the starter passes its own check`);
    for (const item of results) if (guardsOnly(slug, item)) assert.ok(item.ok, `${slug}: "${item.name}" must pass on the starter (${item.error})`);
  }
});

test('every hard starter fails every probe the issue is about, and keeps a regression probe', () => {
  for (const slug of HARD) {
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
    const want = Object.keys(loadCheck(path.join(SUITE, 'checks'), slug).probes).length;
    assert.ok(results.length >= want, `${slug}: only ${results.length} checks`);
    if (HARD.includes(slug)) assert.ok(results.length >= 22, `${slug}: only ${results.length} checks`);
  }
});

test('a plausible partial fix still fails the check, but is better than the starter', () => {
  for (const slug of HARD) {
    const partial = check(slug, `${slug}--partial`);
    const starter = check(slug, null);
    assert.ok(failed(partial).length >= 3, `${slug}: the partial fix fails only ${failed(partial).length} checks`);
    assert.ok(passedCount(partial) > passedCount(starter), `${slug}: the partial fix is no better than the starter`);
    for (const item of partial) if (isRegression(item)) assert.ok(item.ok, `${slug}: the partial fix broke "${item.name}"`);
  }
});

test('the visible tests of each starter say what the issue says', () => {
  for (const slug of SLUGS) {
    const starter = visibleTests(fixtureOf(slug));
    assert.deepEqual(starter.failing, STARTER_VISIBLE_FAILS[slug], `${slug}: visible failures on the starter`);
    assert.equal(starter.fail, STARTER_VISIBLE_FAILS[slug].length);
    assert.ok(starter.pass >= (HARD.includes(slug) ? 8 : 1), `${slug}: only ${starter.pass} visible tests pass`);
  }
});

test('the visible tests all pass on every reference solution and every partial fix', () => {
  for (const slug of SLUGS) {
    const overlays = [slug, ...(fs.existsSync(path.join(SOLUTIONS, `${slug}--partial`)) ? [`${slug}--partial`] : [])];
    assert.equal(overlays.length, HARD.includes(slug) ? 2 : 1, `${slug}: partial fix folders`);
    for (const overlay of overlays) {
      const result = visibleTests(workspaceWith(slug, overlay));
      assert.deepEqual(result.failing, [], overlay);
      assert.equal(result.fail, 0, overlay);
      assert.ok(result.pass >= 1, overlay);
    }
  }
});

test('cart-discount asks for new tests, and its solution brings them', () => {
  assert.match(caseOf('cart-discount').input.task, /add tests for applyDiscount/);
  const added = listFiles(path.join(SOLUTIONS, 'cart-discount')).filter((file) => file.includes(`${path.sep}test${path.sep}`));
  assert.ok(added.length >= 1, 'the solution adds no test file');
});

test('no starter file contains a probe name or an expected value', () => {
  for (const slug of SLUGS) {
    const { probes } = loadCheck(path.join(SUITE, 'checks'), slug);
    // The small tasks ship visible tests that name some of the same behaviours on purpose
    // (the issue says "node --test fails"), so for them only expected values count.
    // For a hard task a probe name is also a needle; a short name such as "digits" is not.
    const needles = new Set(HARD.includes(slug) ? Object.keys(probes).filter((name) => !name.startsWith('keeps') && name.length >= 12) : []);
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
  const roots = [SOLUTIONS, ...SLUGS.flatMap((slug) => [fixtureOf(slug), path.join(SUITE, 'checks', slug)])];
  for (const root of roots) {
    for (const file of listFiles(root)) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!bad.test(text), `${path.relative(REPO, file)} names a home path`);
      assert.ok(!/datasets[\\/]agentic/.test(text), `${path.relative(REPO, file)} points at an old suite`);
    }
  }
});

// A correct solution that is only slow: the reference plus one natural slow method (the whole text parsed
// again for every chunk). The speed probe must fail, and every other probe and file rule must still pass.
test('a slow csv-report solution fails the speed probe and passes the rest', () => {
  const slug = 'csv-report';
  const overlay = path.join(SOLUTIONS, 'csv-report--slow');
  for (const file of listFiles(overlay)) assert.equal(path.relative(overlay, file).split(path.sep)[0], 'src', `${file} is outside src`);
  const work = workspaceWith(slug, slug); // the reference ...
  fs.cpSync(overlay, work, { recursive: true }); // ... with its slow file on top
  const results = checkWork(slug, work);
  const probe = 'keeps a big export fast in small chunks';
  assert.ok(Object.hasOwn(loadCheck(path.join(SUITE, 'checks'), slug).probes, probe), `"${probe}" is not a probe of ${slug}`);
  const bad = failed(results);
  assert.deepEqual(bad.map((item) => item.name), [probe], 'the probes that fail');
  assert.match(bad[0].error, /too slow/, 'it must fail because it is slow');
  assert.equal(passedCount(results), results.length - 1);
});
