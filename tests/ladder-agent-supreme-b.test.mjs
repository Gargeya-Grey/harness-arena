// The supreme-b agent tasks of the ladder (defs/supreme-b, language and data
// components) prove themselves: every starter fails its hidden check, every
// reference solution passes it, a plausible partial build scores clearly lower, the
// visible tests pass on every build, and no starter file leaks a probe name or an
// expected value. All through the real workspace-tests evaluator. No model calls.
//
// Solutions live in tests/fixtures/ladder-agent-solutions/supreme-b/: <slug>/ is the
// reference (files laid over the starter), <slug>--partial/ holds only the files in
// which the partial build differs from the reference; it is laid over the reference.

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
const SOLUTIONS = path.join(HERE, 'fixtures', 'ladder-agent-solutions', 'supreme-b');

const SLUGS = ['ml-type-inference', 'rga-text-crdt', 'spreadsheet-engine', 'markdown-renderer', 'bytecode-vm', 'rrule-expander'];
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

/** The agent's workspace: the starter plus the files of the overlays, in order. */
function workspaceWith(slug, overlays) {
  const work = path.join(tempDir('sb-ws-'), 'work');
  copyTree(fixtureOf(slug), work);
  for (const overlay of overlays) fs.cpSync(path.join(SOLUTIONS, overlay), work, { recursive: true });
  return work;
}

const BUILDS = {
  starter: () => [],
  reference: (slug) => [slug],
  partial: (slug) => [slug, `${slug}--partial`],
};

/** The real evaluator over one workspace, through the same snapshot and rebuild as a run. */
function runCheck(slug, build) {
  const work = workspaceWith(slug, BUILDS[build](slug));
  const runDir = tempDir('sb-run-');
  const artifact = snapshotWorkspace({ fixtureDir: fixtureOf(slug), workDir: work, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-07T00:00:00Z' });
  const run = runWorkspaceCheck({ fixtureDir: fixtureOf(slug), check: loadCheck(path.join(SUITE, 'checks'), slug), runDir, manifestPath: artifact.path });
  assert.equal(run.error, undefined, `${slug} (${build}): the check itself broke: ${run.error}`);
  return run.results;
}

const cache = new Map();
function check(slug, build) {
  const key = `${slug}/${build}`;
  if (!cache.has(key)) cache.set(key, runCheck(slug, build));
  return cache.get(key);
}

const failed = (results) => results.filter((item) => !item.ok);
const share = (results) => results.filter((item) => item.ok).length / results.length;
const isFile = (item) => item.name.startsWith('file ');

function visibleTests(dir) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // else the child reports to this test run instead of printing
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: dir, encoding: 'utf8', timeout: 90_000, windowsHide: true, env });
  const lines = String(run.stdout).split('\n');
  const count = (label) => Number((lines.find((line) => line.startsWith(`# ${label} `)) || '').split(' ')[2]);
  return { pass: count('pass'), fail: count('fail'), failing: lines.filter((line) => line.startsWith('not ok')).map((line) => line.replace(/^not ok \d+ - /, '')) };
}

test('the unit holds six tier 5 cases with a starter and a check each', () => {
  assert.deepEqual(CASES.map((item) => item.input.workspace).sort(), [...SLUGS].sort());
  assert.equal(CASES.length, 6);
  const seen = new Set();
  for (const item of CASES) {
    const slug = item.input.workspace;
    assert.equal(item.case_id, `ladder-agent-${slug}`);
    assert.ok(!seen.has(item.case_id), `duplicate ${item.case_id}`);
    seen.add(item.case_id);
    assert.equal(item.expected.check, slug);
    assert.equal(item.metadata.tier.level, 5);
    assert.equal(item.tags[0], 'tier-5-supreme');
    const minutes = item.metadata.tier.human_minutes;
    assert.ok(minutes > 120 && minutes <= 960, `${slug}: ${minutes} minutes is not tier 5`);
    assert.ok(item.metadata.tier.basis.length > 60, `${slug}: the basis is too short`);
    assert.match(item.input.task, /SPEC\.md/);
    assert.match(item.input.task, /Do not edit/);
    assert.ok(fs.existsSync(path.join(SUITE, 'checks', slug, 'probe.mjs')));
    const { probes, files } = loadCheck(path.join(SUITE, 'checks'), slug);
    const count = Object.keys(probes).length;
    assert.ok(count >= 30 && count <= 60, `${slug}: ${count} probes, want 30 to 60`);
    assert.ok(Object.keys(files).includes('SPEC.md'), `${slug}: SPEC.md is not protected`);
  }
});

test('every starter is a project with a spec, source files and visible tests', () => {
  for (const slug of SLUGS) {
    const spec = fs.readFileSync(path.join(fixtureOf(slug), 'SPEC.md'), 'utf8');
    assert.ok(spec.split('\n').length >= 90, `${slug}: the spec is only ${spec.split('\n').length} lines`);
    const sources = fs.readdirSync(path.join(fixtureOf(slug), 'src'));
    assert.ok(sources.length >= 5, `${slug}: only ${sources.length} source files`);
    assert.ok(fs.readdirSync(path.join(fixtureOf(slug), 'test')).length >= 2, `${slug}: too few test files`);
    assert.ok(fs.existsSync(path.join(fixtureOf(slug), 'package.json')));
  }
});

test('every starter fails every probe and passes only its file rules', () => {
  for (const slug of SLUGS) {
    const results = check(slug, 'starter');
    for (const item of results) {
      if (isFile(item)) assert.ok(item.ok, `${slug}: "${item.name}" must pass on the starter (${item.error})`);
      else assert.ok(!item.ok, `${slug}: "${item.name}" passes on the starter, so it does not test the task`);
    }
    assert.ok(share(results) < 0.15, `${slug}: the starter scores ${share(results)}`);
  }
});

test('every reference solution passes every probe and file rule', () => {
  for (const slug of SLUGS) {
    const results = check(slug, 'reference');
    assert.deepEqual(failed(results).map((item) => `${item.name}: ${item.error}`), [], slug);
    assert.ok(results.length >= 33, `${slug}: only ${results.length} checks`);
  }
});

test('a plausible partial build scores between 40 and 80 percent', () => {
  for (const slug of SLUGS) {
    const partial = check(slug, 'partial');
    const score = share(partial);
    assert.ok(score >= 0.4 && score <= 0.8, `${slug}: the partial build scores ${score.toFixed(3)}`);
    for (const item of partial) if (isFile(item)) assert.ok(item.ok, `${slug}: the partial build broke "${item.name}"`);
  }
});

test('the visible tests pass on every reference solution and every partial build', () => {
  for (const slug of SLUGS) {
    for (const build of ['reference', 'partial']) {
      const result = visibleTests(workspaceWith(slug, BUILDS[build](slug)));
      assert.deepEqual(result.failing, [], `${slug} (${build})`);
      assert.equal(result.fail, 0, `${slug} (${build})`);
      assert.ok(result.pass >= 8, `${slug} (${build}): only ${result.pass} visible tests`);
    }
  }
});

test('the visible tests fail on every starter, because nothing is built', () => {
  for (const slug of SLUGS) {
    const result = visibleTests(fixtureOf(slug));
    assert.ok(result.fail >= 1, `${slug}: the starter passes all its visible tests`);
  }
});

test('no starter file contains a probe name or an expected value', () => {
  for (const slug of SLUGS) {
    const { probes } = loadCheck(path.join(SUITE, 'checks'), slug);
    const task = CASES.find((item) => item.input.workspace === slug).input.task;
    const needles = new Set(Object.keys(probes));
    const walk = (value) => {
      if (typeof value === 'string' && value.length >= 12 && !task.includes(value)) needles.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    Object.values(probes).forEach(walk);
    const files = [];
    const list = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) list(path.join(dir, entry.name));
        else files.push(path.join(dir, entry.name));
      }
    };
    list(fixtureOf(slug));
    assert.ok(files.length >= 8);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const needle of needles) assert.ok(!text.includes(needle), `${slug}: ${path.relative(SUITE, file)} contains ${JSON.stringify(needle).slice(0, 80)}`);
    }
    for (const name of Object.keys(probes)) assert.ok(!task.includes(name), `${slug}: the task text contains the probe name "${name}"`);
  }
});

test('the starters, the checks and the solutions leak no home path or tool setup', () => {
  const bad = /Users[\\/]|AppData|\.claude|C:\\|\/home\//;
  const list = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? list(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  const roots = [SOLUTIONS, ...SLUGS.flatMap((slug) => [fixtureOf(slug), path.join(SUITE, 'checks', slug)])];
  for (const root of roots) {
    for (const file of list(root)) assert.ok(!bad.test(fs.readFileSync(file, 'utf8')), `${path.relative(REPO, file)} names a home path`);
  }
});

// A correct solution that is only slow: the reference plus one natural slow method (array copies, a linear
// search in place of a map, a rescan of everything waiting). Each speed probe it targets must fail, and every
// other probe and file rule must still pass. Speed probes that no natural slow method fails inside the sandbox
// limits are not listed here (see the report of this unit).
const SLOW = [
  {
    slug: 'markdown-renderer',
    overlay: 'markdown-renderer--slow',
    fails: ['md35 emphasis stays fast on long runs', 'md37 a long document renders in linear time'],
  },
  // rr42 sits within a factor of two of its limit even for the reference (140 to 375 ms of CPU against 700), so a
  // constant-factor slowdown of DAILY periods can tip it over on a busy machine: it may fail here, it is not claimed.
  { slug: 'rrule-expander', overlay: 'rrule-expander--slow-days', fails: ['rr40'], maybe: ['rr42'] },
  { slug: 'rrule-expander', overlay: 'rrule-expander--slow-seen', fails: ['rr41', 'rr42', 'rr44'] },
  { slug: 'rrule-expander', overlay: 'rrule-expander--slow-exdates', fails: ['rr42', 'rr43'] },
  {
    slug: 'rga-text-crdt',
    overlay: 'rga-text-crdt--slow',
    fails: ['rg33 ten thousand local inserts, three thousand in the middle, a thousand deletes', 'rg36 deleting a very long range in one call'],
    // rg34 and rg35 stay within 1.2 times their limits with this slow method, so they may fail here and are not claimed.
    maybe: ['rg34 five thousand operations delivered one at a time in reverse', 'rg35 three replicas typing at the start and the end thousands of times'],
  },
  {
    slug: 'spreadsheet-engine',
    overlay: 'spreadsheet-engine--slow',
    fails: ['sp33 three thousand formulas in dependency chains', 'sp34 five hundred formulas summing the same five hundred cells'],
  },
];

test('a slow solution fails the speed probes and passes the rest', () => {
  const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  for (const { slug, overlay, fails, maybe = [] } of SLOW) {
    for (const file of listFiles(path.join(SOLUTIONS, overlay))) assert.equal(path.relative(path.join(SOLUTIONS, overlay), file).split(path.sep)[0], 'src', `${overlay}: ${file} is outside src`);
    const work = workspaceWith(slug, [slug, overlay]); // the reference, then its slow files
    const runDir = tempDir('sb-slow-run-');
    const artifact = snapshotWorkspace({ fixtureDir: fixtureOf(slug), workDir: work, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-07T00:00:00Z' });
    const checkData = loadCheck(path.join(SUITE, 'checks'), slug);
    const run = runWorkspaceCheck({ fixtureDir: fixtureOf(slug), check: checkData, runDir, manifestPath: artifact.path });
    assert.equal(run.error, undefined, `${overlay}: the check itself broke: ${run.error}`);
    const names = failed(run.results).map((item) => item.name);
    assert.deepEqual(names.filter((name) => !maybe.includes(name)), fails, `${overlay}: the probes that fail`);
    for (const name of fails) assert.ok(names.includes(name), `${overlay}: "${name}" passes`);
    for (const name of fails) assert.ok(Object.hasOwn(checkData.probes, name), `${overlay}: "${name}" is not a probe of ${slug}`);
  }
});
