// The supreme agent tasks of the systems-components unit (defs/supreme-a) prove themselves:
// every starter fails its hidden check, every reference solution passes it, a plausible
// partial solution lands between 40% and 80%, the visible tests fail on the starter and pass
// on every overlay, and no starter file leaks a probe name or an expected value.
// All through the real workspace-tests evaluator. No model calls.

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
const SOLUTIONS = path.join(HERE, 'fixtures', 'ladder-agent-solutions', 'supreme-a');

const SLUGS = ['build-scheduler', 'sql-engine', 'log-kv-store', 'http1-parser', 'regex-engine', 'diff-patch'];

const CASES = (await buildCases()).filter((item) => SLUGS.includes(item.input.workspace));

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
const checkOf = (slug) => loadCheck(path.join(SUITE, 'checks'), slug);

/** The agent's workspace: the starter plus the files of an overlay folder. */
function workspaceWith(slug, overlay) {
  const work = path.join(tempDir('supreme-a-ws-'), 'work');
  copyTree(fixtureOf(slug), work);
  if (overlay) fs.cpSync(path.join(SOLUTIONS, overlay), work, { recursive: true });
  return work;
}

/** The real evaluator over one workspace, through the same snapshot and rebuild as a run. */
function check(slug, overlay) {
  const work = workspaceWith(slug, overlay);
  const runDir = tempDir('supreme-a-run-');
  const artifact = snapshotWorkspace({ fixtureDir: fixtureOf(slug), workDir: work, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-07T00:00:00Z' });
  const run = runWorkspaceCheck({ fixtureDir: fixtureOf(slug), check: checkOf(slug), runDir, manifestPath: artifact.path });
  assert.equal(run.error, undefined, `${slug}: the check itself broke: ${run.error}`);
  return run.results;
}

// Each result is cached: a check of the slow tasks takes seconds.
const cache = new Map();
function checked(slug, overlay) {
  const key = `${slug}/${overlay || ''}`;
  if (!cache.has(key)) cache.set(key, check(slug, overlay));
  return cache.get(key);
}

const failed = (results) => results.filter((item) => !item.ok);
const passedCount = (results) => results.filter((item) => item.ok).length;
const isKeepsName = (name) => name.startsWith('keeps');
const isKeeps = (item) => isKeepsName(item.name);
const guardsOnly = (slug, item) => isKeeps(item) || (item.name.startsWith('file ') && checkOf(slug).files[item.name.slice(5)]?.same_as_starter === true);

function visibleTests(dir) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // else the child reports to this test run instead of printing
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: dir, encoding: 'utf8', timeout: 60_000, windowsHide: true, env });
  const lines = String(run.stdout).split('\n');
  const count = (label) => Number((lines.find((line) => line.startsWith(`# ${label} `)) || '').split(' ')[2]);
  return { pass: count('pass'), fail: count('fail'), failing: lines.filter((line) => line.startsWith('not ok')).map((line) => line.replace(/^not ok \d+ - /, '')) };
}

const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

test('the unit has six cases, all tier 5, with an honest time inside the tier', () => {
  assert.equal(CASES.length, 6);
  for (const slug of SLUGS) {
    const item = caseOf(slug);
    assert.ok(item, `${slug}: no case`);
    assert.equal(item.case_id, `ladder-agent-${slug}`);
    assert.equal(item.expected.check, slug);
    assert.equal(item.metadata.tier.level, 5, slug);
    const minutes = item.metadata.tier.human_minutes;
    assert.ok(minutes > 120 && minutes <= 960, `${slug}: ${minutes} minutes is outside tier 5`);
    assert.ok(item.metadata.tier.basis.length >= 80, `${slug}: basis is too short`);
    assert.ok(fs.statSync(fixtureOf(slug)).isDirectory());
    assert.match(item.input.task, /must not be edited/, `${slug}: the task does not say what to do with the tests`);
  }
});

test('every starter is a project with a SPEC, visible tests, stubs, and 30 to 60 probes', () => {
  for (const slug of SLUGS) {
    const dir = fixtureOf(slug);
    assert.ok(fs.existsSync(path.join(dir, 'SPEC.md')), `${slug}: no SPEC.md`);
    assert.ok(fs.existsSync(path.join(dir, 'package.json')), `${slug}: no package.json`);
    assert.ok(fs.readdirSync(path.join(dir, 'src')).length >= 5, `${slug}: too few source files`);
    assert.ok(fs.readdirSync(path.join(dir, 'test')).length >= 1, `${slug}: no visible tests`);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.ok(!pkg.dependencies && !pkg.devDependencies, `${slug}: has dependencies`);
    const probes = Object.keys(checkOf(slug).probes);
    assert.ok(probes.length >= 30 && probes.length <= 60, `${slug}: ${probes.length} probes, want 30 to 60`);
    assert.equal(new Set(probes).size, probes.length);
    assert.ok(probes.some((name) => /fast|speed|large|many|long|perf|linear/i.test(name)), `${slug}: no performance probe`);
    assert.ok(probes.some(isKeepsName), `${slug}: no regression probe`);
    const visible = fs.readdirSync(path.join(dir, 'test')).map((file) => `test/${file}`);
    for (const file of visible) assert.equal(checkOf(slug).files[file]?.same_as_starter, true, `${slug}: ${file} is not protected`);
  }
});

test('every starter fails its check, and passes only the keeps probes and file guards', () => {
  for (const slug of SLUGS) {
    const results = checked(slug, null);
    assert.ok(failed(results).length > 0, `${slug}: the starter passes its own check`);
    for (const item of results) {
      if (guardsOnly(slug, item)) assert.ok(item.ok, `${slug}: "${item.name}" must pass on the starter (${item.error})`);
      else assert.ok(!item.ok, `${slug}: "${item.name}" passes on the starter, so it does not test the task`);
    }
    const share = passedCount(results) / results.length;
    assert.ok(share <= 0.15, `${slug}: the starter passes ${Math.round(share * 100)}%`);
  }
});

test('every reference solution passes every probe and file rule', () => {
  for (const slug of SLUGS) {
    const results = checked(slug, slug);
    assert.deepEqual(failed(results).map((item) => `${item.name}: ${item.error}`), [], slug);
    const want = Object.keys(checkOf(slug).probes).length;
    assert.ok(results.length >= want, `${slug}: only ${results.length} checks`);
  }
});

test('a plausible partial solution scores between 40% and 80% and keeps what worked', () => {
  for (const slug of SLUGS) {
    const results = checked(slug, `${slug}--partial`);
    const share = passedCount(results) / results.length;
    assert.ok(share >= 0.4 && share <= 0.8, `${slug}: the partial solution scores ${Math.round(share * 100)}%`);
    assert.ok(failed(results).length >= 3, `${slug}: the partial solution fails only ${failed(results).length} checks`);
    for (const item of results) if (guardsOnly(slug, item)) assert.ok(item.ok, `${slug}: the partial solution broke "${item.name}"`);
  }
});

test('the visible tests fail on every starter', () => {
  for (const slug of SLUGS) {
    const starter = visibleTests(fixtureOf(slug));
    assert.ok(starter.fail >= 1, `${slug}: no visible test fails on the starter`);
    assert.ok(starter.pass + starter.fail >= 5, `${slug}: only ${starter.pass + starter.fail} visible tests`);
  }
});

test('the visible tests all pass on every reference solution and every partial solution', () => {
  for (const slug of SLUGS) {
    for (const overlay of [slug, `${slug}--partial`]) {
      const result = visibleTests(workspaceWith(slug, overlay));
      assert.deepEqual(result.failing, [], overlay);
      assert.equal(result.fail, 0, overlay);
      assert.ok(result.pass >= 5, `${overlay}: only ${result.pass} visible tests pass`);
    }
  }
});

test('no starter file contains a probe name or an expected value, and the task names none', () => {
  for (const slug of SLUGS) {
    const { probes } = checkOf(slug);
    const needles = new Set(Object.keys(probes).filter((name) => !isKeepsName(name) && name.length >= 12));
    const task = caseOf(slug).input.task;
    const walk = (value) => {
      // A name the task itself states (an error code, a file name) is not hidden.
      if (typeof value === 'string' && value.length >= 12 && !task.includes(value)) needles.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    Object.entries(probes).forEach(([name, value]) => !isKeepsName(name) && walk(value));
    const files = listFiles(fixtureOf(slug));
    assert.ok(files.length >= 8, `${slug}: only ${files.length} starter files`);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const needle of needles) assert.ok(!text.includes(needle), `${slug}: ${path.relative(SUITE, file)} contains ${JSON.stringify(needle).slice(0, 80)}`);
    }
    for (const name of Object.keys(probes).filter((item) => item.length >= 12)) assert.ok(!task.includes(name), `${slug}: the task text contains the probe name "${name}"`);
  }
});

test('the starters, checks and solutions leak no home path, tool setup or old suite name', () => {
  const bad = /Users[\\/]|AppData|\.claude|C:\\|\/home\//;
  // Every overlay folder of a task: the reference, the partial one and the slow ones (<slug>--partial, <slug>--slow, ...).
  const overlays = (slug) => fs.readdirSync(SOLUTIONS).filter((name) => name === slug || name.startsWith(`${slug}--`)).map((name) => path.join(SOLUTIONS, name));
  const roots = SLUGS.flatMap((slug) => [fixtureOf(slug), path.join(SUITE, 'checks', slug), ...overlays(slug)]);
  assert.ok(roots.some((root) => root.endsWith('--slow')), 'the scan sees no slow overlay');
  for (const root of roots) {
    for (const file of listFiles(root)) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!bad.test(text), `${path.relative(REPO, file)} names a home path`);
      assert.ok(!/datasets[\\/]agentic/.test(text), `${path.relative(REPO, file)} points at an old suite`);
    }
  }
});

// A correct solution that is only slow: the reference plus one natural slow method (a rescan of the whole
// upstream, a body copied on every push, a copy of the text on every search). Each speed probe it targets
// must fail, and every other probe and file rule must still pass. Speed probes that no natural slow method
// fails inside the sandbox limits are not listed here (see the report of this unit).
const SLOW = [
  { slug: 'build-scheduler', overlay: 'build-scheduler--slow', fails: ['a long chain and a wide graph finish fast'] },
  {
    slug: 'http1-parser',
    overlay: 'http1-parser--slow',
    fails: ['a body in one-byte pieces stays fast', 'many pipelined requests in one call stay fast', 'a chunked body of tiny chunks in one call stays fast'],
  },
  { slug: 'regex-engine', overlay: 'regex-engine--slow', fails: ['many matches in a long text stay fast'] },
];

test('a slow solution fails the speed probes and passes the rest', () => {
  for (const { slug, overlay, fails } of SLOW) {
    const work = workspaceWith(slug, slug); // the reference ...
    fs.cpSync(path.join(SOLUTIONS, overlay), work, { recursive: true }); // ... with its slow files on top
    for (const file of listFiles(path.join(SOLUTIONS, overlay))) assert.equal(path.relative(path.join(SOLUTIONS, overlay), file).split(path.sep)[0], 'src', `${overlay}: ${file} is outside src`);
    const runDir = tempDir('supreme-a-slow-run-');
    const artifact = snapshotWorkspace({ fixtureDir: fixtureOf(slug), workDir: work, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-07T00:00:00Z' });
    const run = runWorkspaceCheck({ fixtureDir: fixtureOf(slug), check: checkOf(slug), runDir, manifestPath: artifact.path });
    assert.equal(run.error, undefined, `${overlay}: the check itself broke: ${run.error}`);
    assert.deepEqual(failed(run.results).map((item) => item.name), fails, `${overlay}: the probes that fail`);
    assert.equal(passedCount(run.results), run.results.length - fails.length, overlay);
    for (const name of fails) assert.ok(Object.hasOwn(checkOf(slug).probes, name), `${overlay}: "${name}" is not a probe of ${slug}`);
  }
});
