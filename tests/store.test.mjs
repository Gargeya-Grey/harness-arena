// The data folder: runs and annotations live outside git, are shared by every
// worktree, and are read together with the runs committed in results/.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { runCommand } from '../lab/commands/run.mjs';
import { resolveRunDir, scoreCommand } from '../lab/commands/score.mjs';
import { LOCK_FILE, takeLock } from '../lab/lib/lock.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { readJsonl } from '../lab/lib/fsutil.mjs';
import { dataDir, findRunDir, paths, runDirs } from '../lab/lib/repo.mjs';
import { buildState } from '../lab/lib/state.mjs';
import { buildArgs } from '../dashboard/jobs.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'repo');

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setup(t, { agentic = false } = {}) {
  const root = tempDir(t, 'lab-store-root-');
  fs.cpSync(FIXTURES, root, { recursive: true });
  if (agentic) {
    fs.cpSync(path.join(REPO, 'datasets', 'agentic'), path.join(root, 'datasets', 'agentic'), { recursive: true });
    fs.cpSync(path.join(REPO, 'prompts', 'agent-task'), path.join(root, 'prompts', 'agent-task'), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  const data = tempDir(t, 'lab-store-data-');
  const before = { LAB_DATA: process.env.LAB_DATA, LAB_TEST_DATA: process.env.LAB_TEST_DATA };
  process.env.LAB_DATA = data;
  process.env.LAB_TEST_DATA = data;
  t.after(() => {
    for (const [key, value] of Object.entries(before)) value == null ? delete process.env[key] : (process.env[key] = value);
  });
  return { root, data };
}

function fake(t, name, reply) {
  ADAPTERS[name] = {
    name,
    kind: 'cli',
    entrypoint: 'headless',
    access_method: 'subscription',
    supports_effort: false,
    edit: { args: [], note: 'fake' },
    detect: async () => ({ version: '1.0.0' }),
    applied: () => ({}),
    async call(ctx) {
      const text = reply(ctx);
      return { text, finish_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, wall_ms: 1, events: [] };
    },
  };
  t.after(() => delete ADAPTERS[name]);
}

test('dataDir: LAB_DATA wins; lab.local.yaml at the root or at the main checkout of a worktree; tests never read a local file', (t) => {
  const main = tempDir(t, 'lab-main-');
  const worktree = tempDir(t, 'lab-wt-');
  fs.writeFileSync(path.join(main, 'lab.local.yaml'), 'data_dir: ../Model-Lab-Data\n');
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}\n`);
  assert.equal(dataDir(main, {}), path.resolve(main, '..', 'Model-Lab-Data'));
  assert.equal(dataDir(worktree, {}), path.resolve(main, '..', 'Model-Lab-Data'), 'a worktree writes to the main checkout store');
  assert.equal(dataDir(worktree, { LAB_DATA: 'C:/elsewhere' }), path.resolve('C:/elsewhere'));
  // A LAB_DATA from the shell is ignored by the test runner unless a test set LAB_TEST_DATA to it.
  assert.equal(dataDir(worktree, { LAB_DATA: 'C:/elsewhere', NODE_TEST_CONTEXT: 'child' }), null);
  assert.equal(dataDir(worktree, { LAB_DATA: 'C:/elsewhere', LAB_TEST_DATA: 'C:/elsewhere', NODE_TEST_CONTEXT: 'child' }), path.resolve('C:/elsewhere'));
  assert.equal(dataDir(main, { NODE_TEST_CONTEXT: 'child' }), null);
  assert.equal(dataDir(main, { LAB_ROOT: main }), null, 'LAB_ROOT (fixtures, UI work) keeps its own results/');
  fs.writeFileSync(path.join(main, 'lab.local.yaml'), 'data_dir: ""\n');
  assert.throws(() => dataDir(main, {}), /data_dir must be a folder path/);
  fs.writeFileSync(path.join(main, 'lab.local.yaml'), 'data_dir: ./data\n');
  assert.throws(() => dataDir(main, {}), /inside the repository checkout/, 'git clean would delete it');
  assert.throws(() => dataDir(main, { LAB_DATA: path.join(main, 'x') }), /inside the repository checkout/);
  // A sibling worktree is a checkout too: git worktree remove would delete the data.
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
  fs.writeFileSync(path.join(main, '.git', 'worktrees', 'wt', 'gitdir'), `${path.join(worktree, '.git')}
`);
  assert.throws(() => dataDir(main, { LAB_DATA: path.join(worktree, 'data') }), /inside the repository checkout/);
  // git worktree.useRelativePaths writes a gitdir relative to the worktree.
  fs.writeFileSync(path.join(main, 'lab.local.yaml'), 'data_dir: ../Model-Lab-Data\n');
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.relative(worktree, path.join(main, '.git', 'worktrees', 'wt')).split(path.sep).join('/')}\n`);
  const prev = process.cwd();
  process.chdir(os.tmpdir());
  try {
    assert.equal(dataDir(worktree, {}), path.resolve(main, '..', 'Model-Lab-Data'));
  } finally {
    process.chdir(prev);
  }
});

test('new runs go to the data folder; committed runs in results/ are still read, each id once', async (t) => {
  const { root, data } = setup(t);
  const committed = runDirs(root).length;
  assert.ok(committed > 0, 'the fixture repo has committed runs');
  fake(t, 'fake-store', () => '4');
  const file = path.join(root, 'experiments', 'store.yaml');
  fs.writeFileSync(file, ['id: store', 'suite: smoke', 'prompt: qa-single-turn', 'repeats: 1', 'cases: [smoke-001]', 'harness: fake-store', 'models: [claude-haiku]', 'evaluators:', '  - id: exact-match', '    version: "1"', '    dimension: quality', ''].join('\n'));
  const [result] = await runCommand(root, file, { log: () => {} });
  assert.equal(path.dirname(result.runDir), path.join(data, 'results'));
  assert.equal(fs.existsSync(path.join(root, 'results', result.runId)), false);
  assert.equal(runDirs(root).length, committed + 1);
  assert.equal(findRunDir(root, result.runId), result.runDir);
  assert.equal(resolveRunDir(root, result.runId.slice(-6)), result.runDir);
  assert.ok(buildState(root).runs.some((run) => run.run_id === result.runId));
  // A copy of a committed run in the data folder is read once, from the data folder.
  const [first] = runDirs(root).filter(({ dir }) => dir.startsWith(path.join(root, 'results')));
  fs.cpSync(first.dir, path.join(data, 'results', first.name), { recursive: true });
  assert.equal(runDirs(root).length, committed + 1);
  assert.equal(findRunDir(root, first.name), path.join(data, 'results', first.name));
  assert.deepEqual(validateRepo(root).problems, []);
  assert.deepEqual(buildArgs(root, { command: 'run', resume: result.runId }), ['run', '--resume', result.runId]);
  assert.equal(paths(root).annotations, path.join(data, 'annotations'));
});

function agentExperiment(root, id, harness, repeats = 1) {
  const file = path.join(root, 'experiments', `${id}.yaml`);
  fs.writeFileSync(file, [`id: ${id}`, 'suite: agentic', 'prompt: agent-task', `repeats: ${repeats}`, 'cases: [agentic-slugify-bug]', 'workdir: isolated', 'access: edit', `harness: ${harness}`, 'models: [claude-haiku]', 'evaluators:', '  - id: workspace-tests', '    version: "1"', '    dimension: quality', ''].join('\n'));
  return file;
}

/** A live process that is not this one: the runner of another worktree. */
function otherRunner(t) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  t.after(() => child.kill());
  return child.pid;
}

const TAMPER = [
  ['a row added to the current run', ({ current }) => fs.appendFileSync(path.join(current, 'raw.jsonl'), '{"forged":true}\n'), /results\/.*__tamper-0__.*\/raw\.jsonl/],
  ['a finished run edited', ({ finished }) => fs.appendFileSync(path.join(finished, 'raw.jsonl'), '{"planted":true}\n'), /raw\.jsonl in the data folder/],
  ['a file planted beside the runs', ({ data }) => fs.writeFileSync(path.join(data, 'results', 'planted.txt'), 'x'), /results\/planted\.txt in the data folder/],
  ['a run folder planted', ({ data }) => fs.mkdirSync(path.join(data, 'results', '20261105T000001Z__smoke__forged__abcdef')), /forged__abcdef in the data folder/],
  ['a finished run deleted', ({ finished }) => fs.rmSync(finished, { recursive: true, force: true }), /in the data folder/],
  ['a score forged in a finished run', ({ finished }) => {
    fs.mkdirSync(path.join(finished, 'scores'), { recursive: true });
    fs.writeFileSync(path.join(finished, 'scores', 'forged.jsonl'), '{"passed":true}\n');
  }, /scores\/forged\.jsonl in the data folder/],
  // A junction needs no admin rights on Windows; it must show as an entry, never be followed.
  ['a link planted beside the runs', ({ data, cwd }) => fs.symlinkSync(cwd, path.join(data, 'results', 'planted-link'), 'junction'), /results\/planted-link in the data folder/],
  // Names the repository stamp skips are watched in a store: runDirs would read them.
  ...['node_modules', '.cache', '.git'].map((name) => [`a run planted under ${name}`, ({ data, finished }) => fs.cpSync(finished, path.join(data, 'results', name, '20261105T000002Z__smoke__forged__abcdef'), { recursive: true }), new RegExp(`results/${name.replace('.', '\\.')}\\b.* in the data folder`)]),
  ['the lock rewritten', ({ data }) => fs.writeFileSync(path.join(data, LOCK_FILE), '{"pid":4,"command":"forged"}\n'), /\.lab-run\.lock in the data folder/],
  ['the lock deleted', ({ data }) => fs.rmSync(path.join(data, LOCK_FILE)), /\.lab-run\.lock in the data folder/],
  ['the store swapped for a junction to a clean copy', ({ data }) => {
    const moved = path.join(data, 'results-moved');
    fs.cpSync(path.join(data, 'results'), path.join(data, 'clean'), { recursive: true });
    fs.renameSync(path.join(data, 'results'), moved);
    fs.appendFileSync(path.join(moved, fs.readdirSync(moved)[0], 'raw.jsonl'), '{"planted":true}\n');
    fs.symlinkSync(path.join(data, 'clean'), path.join(data, 'results'), 'junction');
  }, /in the data folder/],
  ['a run file made read-only', ({ current }) => fs.chmodSync(path.join(current, 'run.json'), 0o444), /results\/.*__tamper-\d+__.*\/run\.json in the data folder/],
];

for (const [index, [what, act, message]] of TAMPER.entries()) {
  test(`the guard halts on tampering in the data folder: ${what}`, async (t) => {
    const { root, data } = setup(t, { agentic: true });
    const [committed] = runDirs(root);
    const finished = path.join(data, 'results', committed.name);
    fs.cpSync(committed.dir, finished, { recursive: true });
    let current = null;
    fake(t, `fake-tamper-${index}`, ({ cwd }) => {
      current = runDirs(root).find(({ name }) => name.includes(`__tamper-${index}__`)).dir;
      act({ data, finished, current, cwd });
      return 'done';
    });
    const [result] = await runCommand(root, agentExperiment(root, `tamper-${index}`, `fake-tamper-${index}`), { log: () => {} });
    assert.equal(result.halted, true);
    if (what.includes('junction')) return; // the run folder itself was moved away
    // The runner's own row is the last one (a forged row may come before it).
    const row = readJsonl(path.join(result.runDir, 'raw.jsonl')).rows.at(-1);
    assert.equal(row.error.type, 'left_workdir');
    assert.match(row.error.message, message);
  });
}

/** The pid of a process that has finished: the runner of a crash. */
async function goneRunner() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve) => child.on('exit', resolve));
  return child.pid;
}

function writeLock(data, pid) {
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, LOCK_FILE), `${JSON.stringify({ pid, command: 'node lab run other', checkout: 'elsewhere', at: '2026-11-05T00:00:00Z' })}\n`);
}

test('one runner at a time: run, resume and score are refused while another live process holds the lock', async (t) => {
  const { root, data } = setup(t);
  fake(t, 'fake-lock', () => '4');
  const file = path.join(root, 'experiments', 'lock.yaml');
  fs.writeFileSync(file, ['id: lock', 'suite: smoke', 'prompt: qa-single-turn', 'repeats: 1', 'cases: [smoke-001]', 'harness: fake-lock', 'models: [claude-haiku]', 'evaluators:', '  - id: exact-match', '    version: "1"', '    dimension: quality', ''].join('\n'));
  const [first] = await runCommand(root, file, { log: () => {} });
  assert.equal(fs.existsSync(path.join(data, LOCK_FILE)), false, 'a finished run releases the lock');
  writeLock(data, otherRunner(t));
  const before = runDirs(root).length;
  await assert.rejects(runCommand(root, file, { log: () => {} }), /Another lab command is writing to the run store: "node lab run other".*delete .*\.lab-run\.lock/);
  assert.equal(runDirs(root).length, before, 'a refused run writes no run folder');
  await assert.rejects(runCommand(root, null, { resume: first.runId, log: () => {} }), /Another lab command/);
  assert.throws(() => scoreCommand(root, [first.runId], { log: () => {} }), /Another lab command/);
  // A dry run writes nothing, so it needs no lock.
  assert.deepEqual(await runCommand(root, file, { dryRun: true, log: () => {} }), []);
});

test('a lock left by a process that is gone is taken over, and released after the run, also when the run fails', async (t) => {
  const { root, data } = setup(t);
  let fail = false;
  fake(t, 'fake-stale', () => {
    if (fail) throw new Error('harness blew up');
    return '4';
  });
  const file = path.join(root, 'experiments', 'stale.yaml');
  fs.writeFileSync(file, ['id: stale', 'suite: smoke', 'prompt: qa-single-turn', 'repeats: 1', 'cases: [smoke-001]', 'harness: fake-stale', 'models: [claude-haiku]', 'evaluators:', '  - id: exact-match', '    version: "1"', '    dimension: quality', ''].join('\n'));
  writeLock(data, await goneRunner());
  const notes = [];
  const [result] = await runCommand(root, file, { log: (line) => notes.push(line) });
  assert.ok(notes.some((line) => /took over a run store lock left by process \d+, which is gone/.test(line)), notes.join('\n'));
  assert.equal(result.status, 'completed');
  assert.equal(fs.existsSync(path.join(data, LOCK_FILE)), false);
  fail = true;
  await runCommand(root, file, { log: () => {} }).catch(() => {});
  assert.equal(fs.existsSync(path.join(data, LOCK_FILE)), false, 'a failed run releases the lock');
  scoreCommand(root, [result.runId], { force: true, log: () => {} });
  assert.equal(fs.existsSync(path.join(data, LOCK_FILE)), false, 'score releases the lock');
  // A lock file that cannot be read and is new may be one another runner is writing.
  fs.writeFileSync(path.join(data, LOCK_FILE), '');
  assert.throws(() => takeLock(data, { command: 'x', root }), /is being written by another lab command/);
});

test('the guard halts, and does not crash, when the data folder cannot be read after the call', async (t) => {
  const { root, data } = setup(t, { agentic: true });
  let armed = false;
  const read = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function readdir(dir, ...rest) {
    if (armed && String(dir).startsWith(path.join(data, 'results'))) {
      armed = false;
      const error = new Error('access denied');
      error.code = 'EPERM';
      throw error;
    }
    return read.call(this, dir, ...rest);
  });
  fake(t, 'fake-unreadable', () => {
    armed = true;
    return 'done';
  });
  const [result] = await runCommand(root, agentExperiment(root, 'unreadable', 'fake-unreadable'), { log: () => {} });
  assert.equal(result.halted, true);
  const row = readJsonl(path.join(result.runDir, 'raw.jsonl')).rows.at(-1);
  assert.equal(row.error.type, 'left_workdir');
  assert.match(row.error.message, /cannot read \(EPERM access denied\)/);
});

test('the guard keeps the data folder it started with: a LAB_DATA changed during the call is not followed', async (t) => {
  const { root, data } = setup(t, { agentic: true });
  const [committed] = runDirs(root);
  fs.cpSync(committed.dir, path.join(data, 'results', committed.name), { recursive: true });
  const clean = tempDir(t, 'lab-store-clean-');
  fs.cpSync(data, clean, { recursive: true });
  fake(t, 'fake-redirect', () => {
    // Tamper with the real store, then point the lab at a clean copy.
    fs.appendFileSync(path.join(data, 'results', committed.name, 'raw.jsonl'), '{"planted":true}\n');
    process.env.LAB_DATA = clean;
    process.env.LAB_TEST_DATA = clean;
    return 'done';
  });
  const [result] = await runCommand(root, agentExperiment(root, 'redirect', 'fake-redirect'), { log: () => {} });
  assert.equal(result.halted, true);
  assert.match(readJsonl(path.join(result.runDir, 'raw.jsonl')).rows.at(-1).error.message, /raw\.jsonl in the data folder/);
});

test('a lab.local.yaml planted during the call halts: it names the data folder', async (t) => {
  const { root } = setup(t, { agentic: true });
  fake(t, 'fake-config', () => {
    fs.writeFileSync(path.join(root, 'lab.local.yaml'), 'data_dir: ../elsewhere\n');
    return 'done';
  });
  const [result] = await runCommand(root, agentExperiment(root, 'config', 'fake-config'), { log: () => {} });
  assert.equal(result.halted, true);
  assert.match(readJsonl(path.join(result.runDir, 'raw.jsonl')).rows.at(-1).error.message, /lab\.local\.yaml/);
});

test('without a data folder the lock is in results/, and a run planted under node_modules there halts', async (t) => {
  const { root } = setup(t, { agentic: true });
  delete process.env.LAB_DATA;
  const results = path.join(root, 'results');
  const [committed] = runDirs(root);
  fake(t, 'fake-nodata', () => {
    fs.cpSync(committed.dir, path.join(results, 'node_modules', '20261105T000003Z__smoke__forged__abcdef'), { recursive: true });
    return 'done';
  });
  const [result] = await runCommand(root, agentExperiment(root, 'nodata', 'fake-nodata'), { log: () => {} });
  assert.equal(result.halted, true);
  assert.match(readJsonl(path.join(result.runDir, 'raw.jsonl')).rows.at(-1).error.message, /results\/node_modules.* in the repository/);
  assert.equal(fs.existsSync(path.join(results, LOCK_FILE)), false);
  writeLock(results, otherRunner(t));
  await assert.rejects(runCommand(root, agentExperiment(root, 'nodata2', 'fake-nodata'), { log: () => {} }), /Another lab command/);
});

test('a stale lock is taken over by one process only, even when several start at once', async (t) => {
  const data = tempDir(t, 'lab-lock-race-');
  writeLock(data, await goneRunner());
  const lock = new URL('../lab/lib/lock.mjs', import.meta.url).href;
  const script = `import { takeLock } from ${JSON.stringify(lock)};
let release;
try { release = takeLock(${JSON.stringify(data)}, { command: 'race', root: 'race' }); } catch (error) { console.log('refused'); process.exit(0); }
console.log('held');
setTimeout(() => { release(); }, 1500);`;
  const outputs = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('exit', () => resolve(out.trim()));
  })));
  assert.equal(outputs.filter((line) => line === 'held').length, 1, outputs.join(','));
  assert.equal(fs.existsSync(path.join(data, LOCK_FILE)), false);
});

test('the lock: this process\'s own pid in a lock it does not hold is a reused pid; a folder lock is refused clearly', (t) => {
  const data = tempDir(t, 'lab-lock-own-');
  writeLock(data, process.pid);
  const release = takeLock(data, { command: 'own', root: 'own' });
  assert.throws(() => takeLock(data, { command: 'again', root: 'own' }), /already holds/);
  // A forged lock put in place of ours is not deleted by our release.
  fs.writeFileSync(path.join(data, LOCK_FILE), '{"pid":4}\n');
  release();
  assert.equal(fs.readFileSync(path.join(data, LOCK_FILE), 'utf8'), '{"pid":4}\n');
  fs.rmSync(path.join(data, LOCK_FILE));
  fs.mkdirSync(path.join(data, LOCK_FILE));
  assert.throws(() => takeLock(data, { command: 'dir', root: 'own' }), /is not a file\. Delete it/);
});

test('a guard that cannot read the folders before the call makes no call and leaves a run that resumes', async (t) => {
  const { root, data } = setup(t, { agentic: true });
  let calls = 0;
  let armed = true;
  const read = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function readdir(dir, ...rest) {
    if (armed && String(dir).startsWith(path.join(data, 'results')) && new Error().stack.includes('guardStamp')) {
      armed = false;
      const error = new Error('access denied');
      error.code = 'EPERM';
      throw error;
    }
    return read.call(this, dir, ...rest);
  });
  fake(t, 'fake-before', () => {
    calls += 1;
    return 'done';
  });
  const notes = [];
  const [result] = await runCommand(root, agentExperiment(root, 'before', 'fake-before'), { log: (line) => notes.push(line) });
  assert.equal(calls, 0);
  assert.equal(result.halted, false);
  assert.ok(notes.some((line) => /cannot read the lab folders before the call/.test(line)), notes.join('\n'));
  const [resumed] = await runCommand(root, null, { resume: result.runId, log: () => {} });
  assert.equal(calls, 1);
  assert.equal(resumed.status, 'completed');
});

test('a dashboard job keeps the data folder: its child process gets LAB_DATA', async (t) => {
  const { root, data } = setup(t);
  const { createJobs } = await import('../dashboard/jobs.mjs');
  const probe = path.join(root, 'probe.mjs');
  fs.writeFileSync(probe, "console.log('LAB_DATA=' + process.env.LAB_DATA); console.log('LAB_ROOT=' + process.env.LAB_ROOT);\n");
  const jobs = createJobs(root, { cliPath: probe });
  const job = jobs.start({ command: 'validate' });
  let lines = [];
  for (let i = 0; i < 100; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
    const got = jobs.get(job.id);
    lines = (got?.lines || []).map((line) => line.text ?? line);
    if (got && got.job?.status !== 'running' && got.status !== 'running') break;
  }
  assert.ok(lines.some((line) => String(line).includes(`LAB_DATA=${data}`)), lines.join('\n'));
});
