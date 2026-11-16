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
import { appendEntry, closeEntry, ensureLedger, ledgerPath, readLedger, restoreLedger, trustRun } from '../lab/lib/ledger.mjs';
import { adoptCommand } from '../lab/commands/adopt.mjs';
import { scoreRun } from '../lab/commands/score.mjs';
import { crashInLedger } from './crash.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { readJsonl } from '../lab/lib/fsutil.mjs';
import { dataDir, findRunDir, paths, runDirs } from '../lab/lib/repo.mjs';
import { buildState } from '../lab/lib/state.mjs';
import { buildArgs } from '../dashboard/jobs.mjs';
import { runProcess } from '../lab/adapters/process.mjs';
import { setProcessWatch } from '../lab/lib/procwatch.mjs';
import { appendRunFile, writeRunFile } from '../lab/lib/runwrite.mjs';

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
  // These tests start from a store with no ledger: the first command creates it.
  fs.rmSync(path.join(root, 'lab.ledger.jsonl'), { force: true });
  if (agentic) {
    fs.cpSync(path.join(REPO, 'datasets', 'archive', 'agentic'), path.join(root, 'datasets', 'agentic'), { recursive: true });
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

test('a project-local data store permits dashboard history writes during an agent call while keeping run evidence guarded', async (t) => {
  const { root } = setup(t, { agentic: true });
  const localData = path.join(root, '.lab-data');
  process.env.LAB_DATA = localData;
  process.env.LAB_TEST_DATA = localData;
  fake(t, 'fake-local-data', () => {
    for (const name of ['annotations', 'boards', 'reports']) {
      fs.mkdirSync(path.join(localData, name), { recursive: true });
      fs.writeFileSync(path.join(localData, name, 'dashboard.txt'), 'owner dashboard activity');
    }
    return 'done';
  });
  const [valid] = await runCommand(root, agentExperiment(root, 'local-data', 'fake-local-data'), { log: () => {} });
  assert.equal(valid.status, 'completed', 'independent dashboard writes do not halt the model');
  fake(t, 'fake-local-tamper', () => {
    fs.appendFileSync(path.join(valid.runDir, 'raw.jsonl'), '{"tampered":true}\n');
    return 'done';
  });
  const [tampered] = await runCommand(root, agentExperiment(root, 'local-tamper', 'fake-local-tamper'), { log: () => {} });
  assert.equal(tampered.status, 'failed');
  assert(readLedger(ledgerPath(root)).runs.get(tampered.runId).halted, 'changes to saved evidence still halt the run');
});

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
setTimeout(() => { release(); }, 6000);`;
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

const trustOf = (root, runId, runDir) => trustRun(readLedger(ledgerPath(root)), runId, runDir);
const stateRun = (root, runId) => buildState(root).runs.find((run) => run.run_id === runId);

test('ledger: created by the first run with every stored run adopted; a run edited later is caught by state, validate, score and resume', async (t) => {
  const { root, data } = setup(t);
  fake(t, 'fake-ledger', () => '4');
  const file = path.join(root, 'experiments', 'ledger.yaml');
  fs.writeFileSync(file, ['id: ledger', 'suite: smoke', 'prompt: qa-single-turn', 'repeats: 1', 'cases: [smoke-001, smoke-002]', 'harness: fake-ledger', 'models: [claude-haiku]', 'evaluators:', '  - id: exact-match', '    version: "1"', '    dimension: quality', ''].join('\n'));
  assert.equal(fs.existsSync(ledgerPath(root)), false);
  const notes = [];
  const [result] = await runCommand(root, file, { log: (line) => notes.push(line) });
  assert.ok(notes.some((line) => /created the evidence ledger/.test(line)), notes.join('\n'));
  const ledger = readLedger(ledgerPath(root));
  for (const { name } of runDirs(root)) assert.ok(ledger.runs.has(name), `${name} is in the ledger`);
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
  assert.equal(stateRun(root, result.runId).trust.state, 'trusted');
  assert.deepEqual(validateRepo(root).problems, []);
  // Outside any call (no guard watching), a row of the finished run is changed.
  const raw = path.join(result.runDir, 'raw.jsonl');
  fs.writeFileSync(raw, fs.readFileSync(raw, 'utf8').replace('"4"', '"5"'));
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'untrusted');
  const listed = stateRun(root, result.runId);
  assert.equal(listed.trust.state, 'untrusted');
  assert.ok(buildState(root).observations.filter((item) => item.run_id === result.runId).every((item) => item.run_scored === false));
  assert.ok(validateRepo(root).problems.some((line) => line.includes(result.runId) && /does not match the evidence ledger: raw\.jsonl changed/.test(line)));
  const skipped = [];
  assert.deepEqual(scoreRun(root, result.runDir, { log: (line) => skipped.push(line), force: true }), []);
  assert.match(skipped.join('\n'), /does not match the evidence ledger/);
  // A forged score in a finished run does not count; scores are derived, so a re-score repairs them.
  fs.writeFileSync(raw, fs.readFileSync(raw, 'utf8').replace('"5"', '"4"'));
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
  fs.appendFileSync(path.join(result.runDir, 'scores', 'exact-match@1.jsonl'), '{"forged":true}\n');
  const forged = trustOf(root, result.runId, result.runDir);
  assert.equal(forged.scores, 'mismatch');
  assert.match(forged.scores_reason, /scores\/exact-match@1\.jsonl changed/);
  assert.ok(buildState(root).observations.filter((item) => item.run_id === result.runId).every((item) => item.run_scored === false));
  assert.ok(validateRepo(root).problems.some((line) => line.includes(result.runId) && /scores do not match/.test(line)));
  assert.ok(scoreRun(root, result.runDir, { log: () => {} }).length > 0);
  assert.equal(trustOf(root, result.runId, result.runDir).scores, 'match');
  assert.deepEqual(validateRepo(root).problems, []);
  assert.ok(data);
});

test('ledger: the halt is saved first, so a run folder the agent broke never resumes and is never scored', async (t) => {
  const { root } = setup(t, { agentic: true });
  fake(t, 'fake-break', ({ cwd }) => {
    const current = runDirs(root).find(({ name }) => name.includes('__break__')).dir;
    // A passing row for a later repeat, and a folder where the runner writes its events.
    fs.appendFileSync(path.join(current, 'raw.jsonl'), `${JSON.stringify({ forged: true })}\n`);
    fs.mkdirSync(path.join(current, 'harness-events.ndjson'));
    assert.ok(cwd);
    return 'done';
  });
  const notes = [];
  const [result] = await runCommand(root, agentExperiment(root, 'break', 'fake-break', 2), { log: (line) => notes.push(line) });
  assert.equal(result.halted, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(result.runDir, 'run.json'), 'utf8'));
  assert.notEqual(manifest.status, 'running', 'the run closed');
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'halted');
  assert.equal(stateRun(root, result.runId).resumable, false);
  await assert.rejects(runCommand(root, null, { resume: result.runId, force: true, log: () => {} }), /halted by the workdir guard/);
  assert.deepEqual(scoreRun(root, result.runDir, { log: () => {} }), []);
});

test('ledger: a store swapped for a junction and swapped back is still a halted run', async (t) => {
  const { root, data } = setup(t, { agentic: true });
  const results = path.join(data, 'results');
  fake(t, 'fake-swap', () => {
    fs.cpSync(results, path.join(data, 'clean'), { recursive: true });
    fs.renameSync(results, path.join(data, 'moved'));
    fs.symlinkSync(path.join(data, 'clean'), results, 'junction');
    return 'done';
  });
  const [result] = await runCommand(root, agentExperiment(root, 'swap', 'fake-swap'), { log: () => {} });
  assert.equal(result.halted, true);
  // The owner undoes the swap: the real store is back, with the run as the agent left it.
  fs.rmSync(results, { recursive: true, force: true });
  fs.renameSync(path.join(data, 'moved'), results);
  const runDir = path.join(results, result.runId);
  assert.equal(trustOf(root, result.runId, runDir).state, 'halted');
  await assert.rejects(runCommand(root, null, { resume: result.runId, force: true, log: () => {} }), /halted by the workdir guard/);
});

test('ledger: hard links to a finished run do not let the runner write into it', async (t) => {
  const { root, data } = setup(t, { agentic: true });
  const [committed] = runDirs(root);
  const finished = path.join(data, 'results', committed.name);
  fs.cpSync(committed.dir, finished, { recursive: true });
  fake(t, 'fake-link', () => {
    const current = runDirs(root).find(({ name }) => name.includes('__hardlink__')).dir;
    for (const name of ['run.json', 'raw.jsonl']) {
      fs.rmSync(path.join(current, name), { force: true });
      fs.linkSync(path.join(finished, name), path.join(current, name));
    }
    return 'done';
  });
  const before = ['run.json', 'raw.jsonl'].map((name) => fs.readFileSync(path.join(finished, name), 'utf8'));
  const [result] = await runCommand(root, agentExperiment(root, 'hardlink', 'fake-link'), { log: () => {} });
  assert.equal(result.halted, true);
  assert.deepEqual(['run.json', 'raw.jsonl'].map((name) => fs.readFileSync(path.join(finished, name), 'utf8')), before);
  assert.equal(trustOf(root, committed.name, finished).state, 'trusted');
});

test('a store that is a link when the run starts is refused before any call', async (t) => {
  const { root, data } = setup(t, { agentic: true });
  const real = tempDir(t, 'lab-store-real-');
  fs.rmSync(path.join(data, 'results'), { recursive: true, force: true });
  fs.symlinkSync(real, path.join(data, 'results'), 'junction');
  let calls = 0;
  fake(t, 'fake-linked', () => (calls += 1, 'done'));
  await assert.rejects(runCommand(root, agentExperiment(root, 'linked', 'fake-linked'), { log: () => {} }), /is a link .*cannot watch through it/);
  assert.equal(calls, 0);
  assert.deepEqual(fs.readdirSync(real), []);
});

test('ledger: a crash between the row and its entry leaves one unrecorded row; a resume drops it and calls it again', async (t) => {
  const { root } = setup(t);
  let calls = 0;
  fake(t, 'fake-crash', () => (calls += 1, '4'));
  const file = path.join(root, 'experiments', 'crash.yaml');
  fs.writeFileSync(file, ['id: crash', 'suite: smoke', 'prompt: qa-single-turn', 'repeats: 1', 'cases: [smoke-001, smoke-002, smoke-003]', 'harness: fake-crash', 'models: [claude-haiku]', 'evaluators:', '  - id: exact-match', '    version: "1"', '    dimension: quality', ''].join('\n'));
  const [result] = await runCommand(root, file, { log: () => {} });
  const raw = path.join(result.runDir, 'raw.jsonl');
  const lines = fs.readFileSync(raw, 'utf8').split('\n');
  fs.writeFileSync(raw, `${lines[0]}\n${lines[1]}\n`);
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(result.runDir, 'run.json'), 'utf8'));
  fs.writeFileSync(path.join(result.runDir, 'run.json'), JSON.stringify({ ...manifest, status: 'running', finished_at: null, runner: { pid: manifest.runner.pid, heartbeat_at: '2026-01-01T00:00:00.000Z' } }));
  crashInLedger(root, result.runId, 1);
  assert.deepEqual(trustOf(root, result.runId, result.runDir), { state: 'open', scores: 'match', unrecorded_last: true });
  // A second unrecorded row is not a crash: it is refused.
  fs.appendFileSync(raw, `${lines[2]}\n`);
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'untrusted');
  fs.writeFileSync(raw, `${lines[0]}\n${lines[1]}\n`);
  const notes = [];
  const [resumed] = await runCommand(root, null, { resume: result.runId, log: (line) => notes.push(line) });
  assert.ok(notes.some((line) => /dropped the last row/.test(line)), notes.join('\n'));
  assert.equal(calls, 3 + 2);
  assert.equal(resumed.status, 'completed');
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
});

test('with a data folder, a lock held on the checkout\'s results/ refuses the run too', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-both', () => '4');
  const file = path.join(root, 'experiments', 'both.yaml');
  fs.writeFileSync(file, ['id: both', 'suite: smoke', 'prompt: qa-single-turn', 'repeats: 1', 'cases: [smoke-001]', 'harness: fake-both', 'models: [claude-haiku]', 'evaluators:', '  - id: exact-match', '    version: "1"', '    dimension: quality', ''].join('\n'));
  writeLock(path.join(root, 'results'), otherRunner(t));
  await assert.rejects(runCommand(root, file, { log: () => {} }), /Another lab command/);
});

function smokeExperiment(root, id, harness, cases = ['smoke-001', 'smoke-002']) {
  const file = path.join(root, 'experiments', `${id}.yaml`);
  fs.writeFileSync(file, [`id: ${id}`, 'suite: smoke', 'prompt: qa-single-turn', 'repeats: 1', `cases: [${cases.join(', ')}]`, `harness: ${harness}`, 'models: [claude-haiku]', 'evaluators:', '  - id: exact-match', '    version: "1"', '    dimension: quality', ''].join('\n'));
  return file;
}

const crashed = (runDir) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ ...manifest, status: 'running', finished_at: null, runner: { pid: manifest.runner.pid, heartbeat_at: '2026-01-01T00:00:00.000Z' } }));
};

test('ledger: a copy of a trusted run in another folder is not trusted and counts in no aggregate', async (t) => {
  const { root, data } = setup(t);
  fake(t, 'fake-copy', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'copy', 'fake-copy'), { log: () => {} });
  const aggregate = () => Object.values(buildState(root).contexts.find((ctx) => ctx.runs.includes(result.runId)).aggregates)[0];
  const before = aggregate();
  fs.cpSync(result.runDir, path.join(data, 'results', `${result.runId}-copy`), { recursive: true });
  const copy = buildState(root).runs.find((run) => run.trust?.reason?.includes('-copy'));
  assert.equal(copy?.trust.state, 'untrusted');
  const after = aggregate();
  assert.equal(after.n, before.n);
  assert.equal(after.counted_n, before.counted_n);
  assert.equal(after.total_cost_usd, before.total_cost_usd);
});

test('ledger: a crashed run edited before its resume (a stored file, run.json) is refused', async (t) => {
  const { root } = setup(t, { agentic: true });
  fake(t, 'fake-launder', () => 'done');
  const [result] = await runCommand(root, agentExperiment(root, 'launder', 'fake-launder', 2), { log: () => {} });
  crashed(result.runDir);
  crashInLedger(root, result.runId, 1);
  // The recorded files of row 1 still match: the crash alone is open, not changed.
  fs.writeFileSync(path.join(result.runDir, 'raw.jsonl'), `${fs.readFileSync(path.join(result.runDir, 'raw.jsonl'), 'utf8').split('\n')[0]}\n`);
  const recorded = readLedger(ledgerPath(root)).runs.get(result.runId).files;
  const stored = Object.keys(recorded).find((rel) => rel.endsWith('/workspace.json'));
  assert.ok(stored, 'row 1 recorded its workspace files');
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'open');
  fs.appendFileSync(path.join(result.runDir, ...stored.split('/')), '\n// edited\n');
  assert.match(trustOf(root, result.runId, result.runDir).reason, /changed since its row was recorded/);
  await assert.rejects(runCommand(root, null, { resume: result.runId, log: () => {} }), /does not match the evidence ledger/);
  // run.json's fixed fields count too.
  fs.writeFileSync(path.join(result.runDir, ...stored.split('/')), fs.readFileSync(path.join(result.runDir, ...stored.split('/')), 'utf8').replace('\n// edited\n', ''));
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'open');
  const manifest = JSON.parse(fs.readFileSync(path.join(result.runDir, 'run.json'), 'utf8'));
  fs.writeFileSync(path.join(result.runDir, 'run.json'), JSON.stringify({ ...manifest, experiment: { ...manifest.experiment, user_config: 'isolated' } }));
  assert.match(trustOf(root, result.runId, result.runDir).reason, /run\.json changed since the run started/);
});

test('ledger: entries the agent writes during a halted call are dropped, and kept aside', async (t) => {
  const { root, data } = setup(t, { agentic: true });
  const [committed] = runDirs(root);
  fake(t, 'fake-forge', () => {
    // A planted run, and ledger entries that vouch for it.
    const planted = path.join(data, 'results', '20261105T000009Z__smoke__planted__abcdef');
    fs.cpSync(committed.dir, planted, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(planted, 'run.json'), 'utf8'));
    fs.writeFileSync(path.join(planted, 'run.json'), JSON.stringify({ ...manifest, run_id: path.basename(planted) }));
    appendEntry(ledgerPath(root), { kind: 'adopt', run_id: path.basename(planted), files: {}, lines: [] });
    return 'done';
  });
  const [result] = await runCommand(root, agentExperiment(root, 'forge', 'fake-forge'), { log: () => {} });
  assert.equal(result.halted, true);
  const ledger = readLedger(ledgerPath(root));
  assert.equal(ledger.runs.has('20261105T000009Z__smoke__planted__abcdef'), false);
  assert.equal(trustOf(root, '20261105T000009Z__smoke__planted__abcdef', path.join(data, 'results', '20261105T000009Z__smoke__planted__abcdef')).state, 'untrusted');
  assert.equal(fs.readdirSync(path.dirname(ledgerPath(root))).filter((name) => name.startsWith('lab.ledger.halted-')).length, 1);
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'halted');
});

test('ledger: a runner that dies after the halt and before the close still leaves a halted run', async (t) => {
  const { root } = setup(t, { agentic: true });
  fake(t, 'fake-die', () => {
    fs.writeFileSync(path.join(root, 'planted.txt'), 'x');
    return 'done';
  });
  const append = fs.appendFileSync;
  t.mock.method(fs, 'appendFileSync', function appendFile(file, text, ...rest) {
    if (String(file) === ledgerPath(root) && String(text).includes('"kind":"close"')) throw new Error('killed');
    return append.call(this, file, text, ...rest);
  });
  const [result] = await runCommand(root, agentExperiment(root, 'die', 'fake-die'), { log: () => {} });
  t.mock.restoreAll();
  // As if run.json had never been closed: running, stale, no halted mark.
  const manifest = JSON.parse(fs.readFileSync(path.join(result.runDir, 'run.json'), 'utf8'));
  delete manifest.harness.settings.halted;
  fs.writeFileSync(path.join(result.runDir, 'run.json'), JSON.stringify({ ...manifest, status: 'running', finished_at: null, runner: { pid: manifest.runner.pid, heartbeat_at: '2026-01-01T00:00:00.000Z' } }));
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'halted');
  await assert.rejects(runCommand(root, null, { resume: result.runId, force: true, log: () => {} }), /halted by the workdir guard/);
});

test('ledger: a resume of a stopped run reopens it first, so during the resume (or after a crash in it) it reads as open', async (t) => {
  const { root } = setup(t);
  const seen = [];
  let calls = 0;
  let resuming = false;
  let result;
  fake(t, 'fake-reopen', () => {
    calls += 1;
    if (!resuming && calls === 1) process.emit('SIGINT', 'cancel');
    if (resuming) seen.push(trustOf(root, result.runId, result.runDir).state);
    return '4';
  });
  [result] = await runCommand(root, smokeExperiment(root, 'reopen', 'fake-reopen', ['smoke-001', 'smoke-002', 'smoke-003']), { log: () => {} });
  // A stopped run is closed in the ledger, as interrupted.
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.runDir, 'run.json'), 'utf8')).runner.interrupted, true);
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
  resuming = true;
  await runCommand(root, null, { resume: result.runId, log: () => {} });
  assert.deepEqual(seen, ['open', 'open']);
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
});

test('ledger: an adopted crashed run with a torn line resumes', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-adopted', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'adopted', 'fake-adopted', ['smoke-001', 'smoke-002', 'smoke-003']), { log: () => {} });
  const raw = path.join(result.runDir, 'raw.jsonl');
  const lines = fs.readFileSync(raw, 'utf8').split('\n');
  fs.writeFileSync(raw, `${lines[0]}\n${lines[1].slice(0, 30)}`);
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
  crashed(result.runDir);
  fs.rmSync(ledgerPath(root));
  const [resumed] = await runCommand(root, null, { resume: result.runId, log: () => {} });
  assert.equal(resumed.status, 'completed');
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
});

test('ledger: node lab adopt vouches for a run the ledger does not know; a torn ledger line swallows no entry', async (t) => {
  const { root, data } = setup(t);
  fake(t, 'fake-adopt', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'adopt', 'fake-adopt'), { log: () => {} });
  const name = '20261105T000010Z__smoke__other__abcdef';
  const other = path.join(data, 'results', name);
  fs.cpSync(result.runDir, other, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(other, 'run.json'), 'utf8'));
  fs.writeFileSync(path.join(other, 'run.json'), JSON.stringify({ ...manifest, run_id: name }));
  assert.equal(trustOf(root, name, other).state, 'untrusted');
  fs.appendFileSync(ledgerPath(root), '{"torn":');
  assert.deepEqual(adoptCommand(root, [name], { log: () => {} }), [name]);
  assert.equal(trustOf(root, name, other).state, 'trusted');
  assert.equal(readLedger(ledgerPath(root)).torn.length, 1, 'only the torn line is lost');
  // A torn line is a warning, not a problem: it can only make a run less trusted.
  const report = validateRepo(root);
  assert.ok(report.warnings.some((line) => /line \d+: invalid JSON.*the entry on it is lost/.test(line)), report.warnings.join('\n'));
  assert.ok(!report.problems.some((line) => /invalid JSON/.test(line)), report.problems.join('\n'));
});

test('the ledger has a lock of its own: a command holding it refuses a run', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-ledger-lock', () => '4');
  writeLock(path.dirname(ledgerPath(root)), otherRunner(t));
  await assert.rejects(runCommand(root, smokeExperiment(root, 'ledgerlock', 'fake-ledger-lock'), { log: () => {} }), /Another lab command/);
});

test('ledger: a score file no evaluator of the run wrote is never read, and a re-score does not launder it', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-stray', () => 'wrong');
  const [result] = await runCommand(root, smokeExperiment(root, 'stray', 'fake-stray'), { log: () => {} });
  const aggregate = () => Object.values(buildState(root).contexts.find((ctx) => ctx.runs.includes(result.runId)).aggregates)[0];
  const before = aggregate();
  const rows = fs.readFileSync(path.join(result.runDir, 'raw.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const planted = path.join(result.runDir, 'scores', 'aaa@1.jsonl');
  fs.writeFileSync(planted, rows.map((row) => JSON.stringify({ run_id: result.runId, case_id: row.case_id, model_key: row.model_key, repeat: row.repeat, evaluator_id: 'aaa', evaluator_version: '1', dimension: 'quality', value: 1, passed: true })).join('\n') + '\n');
  assert.deepEqual(aggregate(), before);
  scoreRun(root, result.runDir, { log: () => {} });
  assert.deepEqual(aggregate(), before);
  assert.equal(trustOf(root, result.runId, result.runDir).scores, 'match');
  assert.ok(validateRepo(root).problems.some((line) => line.includes('aaa@1.jsonl') && /never read/.test(line)));
  assert.ok(!Object.keys(readLedger(ledgerPath(root)).runs.get(result.runId).scores).includes('scores/aaa@1.jsonl'));
});

for (const [label, sabotage] of [
  ['read-only', (file) => fs.chmodSync(file, 0o444)],
  ['a folder', (file) => {
    fs.rmSync(file);
    fs.mkdirSync(file);
  }],
]) {
  test(`ledger: a halt restores a ledger the agent made ${label}, and drops the entries it wrote`, async (t) => {
    const { root, data } = setup(t, { agentic: true });
    const [committed] = runDirs(root);
    const id = '20261105T000011Z__smoke__planted__abcdef';
    const planted = path.join(data, 'results', id);
    t.after(() => {
      try {
        fs.chmodSync(ledgerPath(root), 0o666);
      } catch {
        // Gone or a folder.
      }
    });
    fake(t, `fake-sabotage-${label.replace(/\W/g, '')}`, () => {
      fs.cpSync(committed.dir, planted, { recursive: true });
      const manifest = JSON.parse(fs.readFileSync(path.join(planted, 'run.json'), 'utf8'));
      fs.writeFileSync(path.join(planted, 'run.json'), JSON.stringify({ ...manifest, run_id: id }));
      appendEntry(ledgerPath(root), closeEntry('adopt', id, planted, { by: 'owner' }));
      sabotage(ledgerPath(root));
      return 'done';
    });
    const [result] = await runCommand(root, agentExperiment(root, `sabotage${label.replace(/\W/g, '')}`, `fake-sabotage-${label.replace(/\W/g, '')}`), { log: () => {} });
    assert.equal(result.halted, true);
    assert.equal(fs.lstatSync(ledgerPath(root)).isFile(), true);
    assert.equal(readLedger(ledgerPath(root)).runs.has(id), false);
    assert.equal(trustOf(root, id, planted).state, 'untrusted');
    assert.equal(trustOf(root, result.runId, result.runDir).state, 'halted');
  });
}

test('ledger: a ledger that cannot be read trusts no run', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-unreadable', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'unreadable', 'fake-unreadable'), { log: () => {} });
  fs.rmSync(ledgerPath(root));
  fs.mkdirSync(ledgerPath(root));
  assert.equal(stateRun(root, result.runId).trust.state, 'untrusted');
  assert.ok(validateRepo(root).problems.some((line) => /cannot read the evidence ledger/.test(line)));
  assert.deepEqual(scoreRun(root, result.runDir, { log: () => {} }), []);
});

test('ledger: adopt --all never adopts a halted run; naming it does', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-adopt-halt', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'adopthalt', 'fake-adopt-halt'), { log: () => {} });
  appendEntry(ledgerPath(root), { kind: 'halt', run_id: result.runId, reason: 'left_workdir' });
  assert.ok(!adoptCommand(root, [], { all: true, log: () => {} }).includes(result.runId));
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'halted');
  const notes = [];
  assert.deepEqual(adoptCommand(root, [result.runId], { log: (line) => notes.push(line) }), [result.runId]);
  assert.ok(notes.some((line) => /was halted by the workdir guard/.test(line)));
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
});

/** A fake harness whose every answer comes with one event; counts its calls by case. */
function eventsHarness(t, name, calls) {
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
      calls.push(ctx.model);
      return { text: '4', finish_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, wall_ms: 1, events: [{ type: 'note', text: `answered ${calls.length}` }] };
    },
  };
  t.after(() => delete ADAPTERS[name]);
}

for (const [label, failing] of [
  ['the raw row', (file, text) => String(file).endsWith('raw.jsonl')],
  ['its events', (file) => String(file).endsWith('harness-events.ndjson')],
  ['its ledger entry', (file, text, root) => String(file) === ledgerPath(root) && String(text).includes('"kind":"row"')],
]) {
  test(`a write that fails after a call the guard passed (${label}) leaves the run open, and a resume calls that row again`, async (t) => {
    const { root } = setup(t);
    const calls = [];
    eventsHarness(t, `fake-busy-${label.length}`, calls);
    const append = fs.appendFileSync;
    let seen = 0;
    let failed = false;
    t.mock.method(fs, 'appendFileSync', function appendFile(file, text, ...rest) {
      if (!failed && failing(file, text, root) && (seen += 1) === 2) {
        failed = true;
        throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
      }
      return append.call(this, file, text, ...rest);
    });
    const [result] = await runCommand(root, smokeExperiment(root, `busy${label.length}`, `fake-busy-${label.length}`, ['smoke-001', 'smoke-002', 'smoke-003']), { log: () => {} });
    t.mock.restoreAll();
    assert.equal(failed, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(result.runDir, 'run.json'), 'utf8'));
    assert.equal(manifest.harness.settings.halted, undefined);
    assert.equal(manifest.runner.interrupted, true);
    // No close entry vouches for the half-stored row: the run is open, and counts nowhere.
    assert.equal(trustOf(root, result.runId, result.runDir).state, 'open');
    assert.ok(buildState(root).observations.filter((item) => item.run_id === result.runId).every((item) => item.trusted === false));
    const [resumed] = await runCommand(root, null, { resume: result.runId, log: () => {} });
    assert.equal(resumed.status, 'completed');
    assert.equal(calls.length, 4, 'the failed row is called again, once');
    assert.deepEqual(fs.readFileSync(path.join(result.runDir, 'raw.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).case_id), ['smoke-001', 'smoke-002', 'smoke-003']);
    assert.equal(fs.readFileSync(path.join(result.runDir, 'harness-events.ndjson'), 'utf8').split('\n').filter(Boolean).length, 3);
    assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
    assert.deepEqual(validateRepo(root).problems, []);
  });
}

test('ledger: events edited after a crash are caught, and the run is not resumed', async (t) => {
  const { root } = setup(t);
  const calls = [];
  eventsHarness(t, 'fake-events', calls);
  const [result] = await runCommand(root, smokeExperiment(root, 'events', 'fake-events', ['smoke-001', 'smoke-002', 'smoke-003']), { log: () => {} });
  const raw = path.join(result.runDir, 'raw.jsonl');
  fs.writeFileSync(raw, `${fs.readFileSync(raw, 'utf8').split('\n').slice(0, 2).join('\n')}\n`);
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
  crashed(result.runDir);
  crashInLedger(root, result.runId, 2);
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'open');
  const events = path.join(result.runDir, 'harness-events.ndjson');
  fs.writeFileSync(events, fs.readFileSync(events, 'utf8').replace('answered 1', 'answered X'));
  assert.match(trustOf(root, result.runId, result.runDir).reason, /harness-events\.ndjson changed/);
  await assert.rejects(runCommand(root, null, { resume: result.runId, log: () => {} }), /does not match the evidence ledger/);
});

test('ledger: an open run counts in no aggregate, its one unrecorded row included', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-open-agg', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'openagg', 'fake-open-agg', ['smoke-001', 'smoke-002', 'smoke-003']), { log: () => {} });
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
  crashed(result.runDir);
  crashInLedger(root, result.runId, 2);
  const raw = path.join(result.runDir, 'raw.jsonl');
  const lines = fs.readFileSync(raw, 'utf8').split('\n').filter(Boolean);
  const forged = { ...JSON.parse(lines[2]), latency_ms: 987654 };
  fs.writeFileSync(raw, `${[lines[0], lines[1], JSON.stringify(forged)].join('\n')}\n`);
  assert.deepEqual(trustOf(root, result.runId, result.runDir), { state: 'open', scores: 'match', unrecorded_last: true });
  const state = buildState(root);
  assert.ok(state.observations.filter((item) => item.run_id === result.runId).every((item) => item.trusted === false));
  const ctx = state.contexts.find((item) => item.runs.includes(result.runId));
  for (const agg of Object.values(ctx.aggregates)) assert.equal(agg.n, 0);
});

test('ledger: a run whose scores do not match counts in no metric at all', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-mis', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'mis', 'fake-mis'), { log: () => {} });
  const file = path.join(result.runDir, 'scores', 'exact-match@1.jsonl');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"value":1', '"value":0'));
  assert.equal(trustOf(root, result.runId, result.runDir).scores, 'mismatch');
  const ctx = buildState(root).contexts.find((item) => item.runs.includes(result.runId));
  for (const agg of Object.values(ctx.aggregates)) {
    assert.equal(agg.n, 0);
    assert.equal(agg.scored_n ?? 0, 0);
  }
});

test('ledger: a resumed run keeps no old scores: they count again only once rescored', async (t) => {
  const { root } = setup(t);
  let calls = 0;
  fake(t, 'fake-stale', () => {
    calls += 1;
    if (calls === 2) process.emit('SIGINT', 'cancel');
    return '4';
  });
  const [result] = await runCommand(root, smokeExperiment(root, 'stale', 'fake-stale', ['smoke-001', 'smoke-002', 'smoke-003']), { log: () => {} });
  assert.ok(fs.readdirSync(path.join(result.runDir, 'scores')).length, 'the stopped run was scored');
  // The resume closes the run; its scoring then fails.
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', function renameFile(from, to, ...rest) {
    if (String(to).includes(`${path.sep}scores${path.sep}`)) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return rename.call(this, from, to, ...rest);
  });
  await runCommand(root, null, { resume: result.runId, log: () => {} }).catch(() => {});
  t.mock.restoreAll();
  const trust = trustOf(root, result.runId, result.runDir);
  assert.equal(trust.scores, 'mismatch');
  assert.ok(buildState(root).observations.filter((item) => item.run_id === result.runId).every((item) => item.trusted === false));
  scoreRun(root, result.runDir, { log: () => {} });
  assert.equal(trustOf(root, result.runId, result.runDir).scores, 'match');
});

test('ledger: a score file of an evaluator that cannot run is never recorded by a rescore', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-gone', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'gone', 'fake-gone'), { log: () => {} });
  // A run made with an evaluator this checkout no longer has, adopted as it was.
  const manifestFile = path.join(result.runDir, 'run.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, evaluators: [...manifest.evaluators, { id: 'retired', version: '1', dimension: 'quality' }] }));
  const gone = path.join(result.runDir, 'scores', 'retired@1.jsonl');
  fs.writeFileSync(gone, fs.readFileSync(path.join(result.runDir, 'scores', 'exact-match@1.jsonl'), 'utf8').replaceAll('exact-match', 'retired'));
  adoptCommand(root, [result.runId], { log: () => {} });
  assert.equal(trustOf(root, result.runId, result.runDir).scores, 'match');
  fs.writeFileSync(gone, fs.readFileSync(gone, 'utf8').replaceAll('"value":1', '"value":0'));
  assert.equal(trustOf(root, result.runId, result.runDir).scores, 'mismatch');
  scoreRun(root, result.runDir, { log: () => {} });
  const trust = trustOf(root, result.runId, result.runDir);
  assert.equal(trust.scores, 'mismatch');
  assert.match(trust.scores_reason, /retired@1\.jsonl/);
  assert.ok(buildState(root).observations.filter((item) => item.run_id === result.runId).every((item) => item.trusted === false));
});

test('a rescore never writes through a link: a hard-linked score file, a linked scores folder', async (t) => {
  const { root, data } = setup(t);
  fake(t, 'fake-link-score', () => '4');
  const [victim] = await runCommand(root, smokeExperiment(root, 'victim', 'fake-link-score'), { log: () => {} });
  const [result] = await runCommand(root, smokeExperiment(root, 'linker', 'fake-link-score'), { log: () => {} });
  const victimFile = path.join(victim.runDir, 'run.json');
  const before = fs.readFileSync(victimFile);
  const score = path.join(result.runDir, 'scores', 'exact-match@1.jsonl');
  fs.rmSync(score);
  fs.linkSync(victimFile, score);
  scoreRun(root, result.runDir, { log: () => {} });
  assert.deepEqual(fs.readFileSync(victimFile), before, 'the other run is untouched');
  assert.equal(fs.statSync(score).nlink, 1);
  // A scores folder that is a link into another run is refused.
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true });
  fs.symlinkSync(victim.runDir, path.join(result.runDir, 'scores'), 'junction');
  t.after(() => fs.rmSync(path.join(result.runDir, 'scores'), { force: true }));
  const victimFiles = fs.readdirSync(victim.runDir).sort();
  assert.throws(() => writeRunFile(result.runDir, 'scores/exact-match@1.jsonl', 'x'), /not a plain folder/);
  // The scorer does not get that far: the linked folder makes the run untrusted, so it is skipped.
  let written = [];
  try {
    written = scoreRun(root, result.runDir, { log: () => {} });
  } catch {
    written = [];
  }
  assert.deepEqual(written, []);
  assert.deepEqual(fs.readdirSync(victim.runDir).sort(), victimFiles);
  assert.deepEqual(fs.readFileSync(victimFile), before);
  assert.ok(data);
});

test('ledger: a resume after a crash before a row entry keeps the run open while that call is made again', async (t) => {
  const { root } = setup(t, { agentic: true });
  let calls = 0;
  let resuming = false;
  let result;
  const seen = [];
  fake(t, 'fake-window', (ctx) => {
    calls += 1;
    fs.writeFileSync(path.join(ctx.cwd, 'y.txt'), `y${calls}`);
    if (!resuming) fs.writeFileSync(path.join(ctx.cwd, 'z.txt'), 'z');
    if (resuming) seen.push(trustOf(root, result.runId, result.runDir).state);
    return 'done';
  });
  [result] = await runCommand(root, agentExperiment(root, 'window', 'fake-window', 3), { log: () => {} });
  // As a runner that died after row 1 reached raw.jsonl and before its ledger entry.
  const raw = path.join(result.runDir, 'raw.jsonl');
  fs.writeFileSync(raw, `${fs.readFileSync(raw, 'utf8').split('\n')[0]}\n`);
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
  crashed(result.runDir);
  crashInLedger(root, result.runId, 0);
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'open');
  resuming = true;
  const [resumed] = await runCommand(root, null, { resume: result.runId, log: () => {} });
  assert.equal(resumed.status, 'completed');
  assert.deepEqual(seen, ['open', 'open', 'open']);
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
});

/** Rewrite the ledger: keep, or change, each entry of one run. */
function editLedger(root, runId, edit) {
  const file = ledgerPath(root);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    const entry = JSON.parse(line);
    if (entry.run_id !== runId) return [line];
    const next = edit(entry);
    return next ? [JSON.stringify(next)] : [];
  });
  fs.writeFileSync(file, lines.map((line) => `${line}\n`).join(''));
}

test('ledger: a run open since before rows bound events keeps its events on a resume', async (t) => {
  const { root } = setup(t);
  const calls = [];
  eventsHarness(t, 'fake-unbound', calls);
  const [result] = await runCommand(root, smokeExperiment(root, 'unbound', 'fake-unbound', ['smoke-001', 'smoke-002', 'smoke-003']), { log: () => {} });
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
  crashed(result.runDir);
  crashInLedger(root, result.runId, 2);
  // Entries as a runner from before the events record wrote them.
  editLedger(root, result.runId, ({ events, ...entry }) => entry);
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'open');
  const [resumed] = await runCommand(root, null, { resume: result.runId, log: () => {} });
  assert.equal(resumed.status, 'completed');
  const events = fs.readFileSync(path.join(result.runDir, 'harness-events.ndjson'), 'utf8');
  assert.match(events, /answered 1"/);
  assert.match(events, /answered 2"/);
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
});

test('ledger: an adopted run whose run.json still says running counts in no aggregate', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-stale-adopt', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'staleadopt', 'fake-stale-adopt'), { log: () => {} });
  crashed(result.runDir);
  adoptCommand(root, [result.runId], { log: () => {} });
  assert.equal(trustOf(root, result.runId, result.runDir).state, 'trusted');
  const rows = buildState(root).observations.filter((item) => item.run_id === result.runId);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((item) => item.trusted === false));
});

test('ledger: a closed run with evaluators and no recorded scores counts nowhere until scored', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-unscored', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'unscored', 'fake-unscored'), { log: () => {} });
  // As a scorer that died before it wrote anything.
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
  editLedger(root, result.runId, (entry) => (entry.kind === 'scores' ? null : entry));
  const trust = trustOf(root, result.runId, result.runDir);
  assert.equal(trust.state, 'trusted');
  assert.equal(trust.scores, 'mismatch');
  assert.match(trust.scores_reason, /no recorded scores/);
  assert.ok(buildState(root).observations.filter((item) => item.run_id === result.runId).every((item) => item.trusted === false));
  scoreRun(root, result.runDir, { log: () => {} });
  assert.equal(trustOf(root, result.runId, result.runDir).scores, 'match');
});

test('ledger: an adopted run with no scores counts nowhere until scored; a stray score file changes nothing', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-adopt-none', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'adoptnone', 'fake-adopt-none'), { log: () => {} });
  fs.rmSync(path.join(result.runDir, 'scores'), { recursive: true, force: true });
  editLedger(root, result.runId, () => null);
  adoptCommand(root, [result.runId], { log: () => {} });
  const rowsOf = () => buildState(root).observations.filter((item) => item.run_id === result.runId);
  assert.equal(trustOf(root, result.runId, result.runDir).scores, 'mismatch');
  assert.ok(rowsOf().length > 0);
  assert.ok(rowsOf().every((item) => item.trusted === false && item.run_scored === false), 'cost, latency and errors do not count either');
  // A file no evaluator of the run writes does not make it scored.
  fs.mkdirSync(path.join(result.runDir, 'scores'));
  fs.writeFileSync(path.join(result.runDir, 'scores', 'stray@1.jsonl'), '{"value":1}\n');
  assert.deepEqual(trustOf(root, result.runId, result.runDir).stray_scores, ['scores/stray@1.jsonl']);
  assert.ok(rowsOf().every((item) => item.trusted === false));
  scoreRun(root, result.runDir, { log: () => {} });
  assert.equal(trustOf(root, result.runId, result.runDir).scores, 'match');
  assert.ok(rowsOf().every((item) => item.trusted === true && item.run_scored === true));
});

test('ledger: a run scored by only some of its evaluators counts nowhere', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-part', () => '4');
  const [result] = await runCommand(root, smokeExperiment(root, 'part', 'fake-part'), { log: () => {} });
  // A run made with a second evaluator this checkout no longer has, adopted as it is.
  const manifestFile = path.join(result.runDir, 'run.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, evaluators: [...manifest.evaluators, { id: 'retired', version: '1', dimension: 'quality' }] }));
  adoptCommand(root, [result.runId], { log: () => {} });
  const trust = trustOf(root, result.runId, result.runDir);
  assert.equal(trust.scores, 'mismatch');
  assert.match(trust.scores_reason, /retired@1\.jsonl/);
  assert.ok(buildState(root).observations.filter((item) => item.run_id === result.runId).every((item) => item.trusted === false));
});

test('ledger: a closed run with no declared evaluators counts for cost, latency and errors, with no quality', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-noeval', () => '4');
  const file = path.join(root, 'experiments', 'noeval.yaml');
  fs.writeFileSync(file, ['id: noeval', 'suite: smoke', 'prompt: qa-single-turn', 'repeats: 1', 'cases: [smoke-001]', 'harness: fake-noeval', 'models: [claude-haiku]', 'evaluators: []', ''].join('\n'));
  const [result] = await runCommand(root, file, { log: () => {} });
  assert.deepEqual(trustOf(root, result.runId, result.runDir), { state: 'trusted', scores: 'match' });
  const rows = buildState(root).observations.filter((item) => item.run_id === result.runId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trusted, true);
  assert.equal(rows[0].run_scored, false);
});

test('ledger: without a ledger no run counts', (t) => {
  const { root } = setup(t);
  const state = buildState(root);
  assert.ok(state.runs.length > 0);
  assert.ok(state.runs.every((run) => run.trust.state === 'legacy'));
  assert.ok(state.observations.length > 0);
  assert.ok(state.observations.every((item) => item.trusted === false));
});

test('ledger: a halt restore never chmods a ledger that is a hard link to a read-only file', (t) => {
  const dir = tempDir(t, 'lab-store-restore-');
  const victim = path.join(dir, 'victim.json');
  fs.writeFileSync(victim, 'keep');
  const file = path.join(dir, 'lab.ledger.jsonl');
  fs.linkSync(victim, file);
  fs.chmodSync(victim, 0o444);
  try {
    const aside = restoreLedger(file, Buffer.from('{"kind":"open"}\n'), { kind: 'halt', run_id: 'r', reason: 'left_workdir' }, { asideName: 'lab.ledger.halted-r.jsonl' });
    assert.ok(aside);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
    assert.equal(fs.statSync(victim).mode & 0o200, 0, 'the other file is still read-only');
    assert.equal(fs.statSync(file).nlink, 1);
    assert.match(fs.readFileSync(file, 'utf8'), /"kind":"halt"/);
  } finally {
    for (const name of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, name), 0o666);
  }
});

test('a read-only file with a second link is refused, and the other file stays as it was', (t) => {
  const dir = tempDir(t, 'lab-store-ro-');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'keep');
  fs.linkSync(victim, path.join(runDir, 'run.json'));
  fs.linkSync(victim, path.join(runDir, 'raw.jsonl'));
  fs.chmodSync(victim, 0o444);
  try {
    assert.throws(() => writeRunFile(runDir, 'run.json', 'x'), /read-only hard link/);
    assert.throws(() => appendRunFile(runDir, 'raw.jsonl', 'x'), /read-only hard link/);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
    assert.equal(fs.statSync(victim).mode & 0o200, 0, 'the other file is still read-only');
  } finally {
    fs.chmodSync(victim, 0o666);
  }
});

test('ledger: creating it is all or nothing', (t) => {
  const { root } = setup(t);
  const append = fs.appendFileSync;
  let count = 0;
  t.mock.method(fs, 'appendFileSync', function appendFile(file, text, ...rest) {
    if (String(file).endsWith('.tmp') && (count += 1) === 3) throw new Error('killed');
    return append.call(this, file, text, ...rest);
  });
  assert.throws(() => ensureLedger(root), /killed/);
  t.mock.restoreAll();
  assert.equal(fs.existsSync(ledgerPath(root)), false);
  assert.deepEqual(fs.readdirSync(path.dirname(ledgerPath(root))).filter((name) => name.endsWith('.tmp')), []);
  assert.ok(ensureLedger(root) > 3);
  for (const { name } of runDirs(root)) assert.ok(readLedger(ledgerPath(root)).runs.has(name), name);
});

test('ledger: creating it adopts the committed runs of every worktree', (t) => {
  const { root } = setup(t);
  const [committed] = runDirs(root);
  const worktree = tempDir(t, 'lab-store-worktree-');
  const id = '20261105T000012Z__smoke__worktree__abcdef';
  fs.cpSync(committed.dir, path.join(worktree, 'results', id), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(worktree, 'results', id, 'run.json'), 'utf8'));
  fs.writeFileSync(path.join(worktree, 'results', id, 'run.json'), JSON.stringify({ ...manifest, run_id: id }));
  fs.mkdirSync(path.join(root, '.git', 'worktrees', 'wt'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'worktrees', 'wt', 'gitdir'), `${path.join(worktree, '.git')}\n`);
  ensureLedger(root);
  assert.equal(readLedger(ledgerPath(root)).runs.has(id), true);
});

test('process watch: a process the agent leaves running, even after a double fork, is ended after the call', { skip: process.platform !== 'win32' && 'Job Objects are Windows only' }, async (t) => {
  const { root } = setup(t, { agentic: true });
  const pidFile = path.join(tempDir(t, 'lab-store-pid-'), 'pid.txt');
  const inner = `const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{detached:true,stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));c.unref();`;
  const outer = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(inner)}],{detached:true,stdio:'ignore'}).unref();setTimeout(()=>{},300)`;
  ADAPTERS['fake-linger'] = {
    name: 'fake-linger',
    kind: 'cli',
    entrypoint: 'headless',
    access_method: 'subscription',
    supports_effort: false,
    edit: { args: [], note: 'fake' },
    detect: async () => ({ version: '1.0.0' }),
    applied: () => ({}),
    async call() {
      const result = await runProcess('node', ['-e', outer], { timeoutMs: 30000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { text: 'done', finish_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, wall_ms: 1, events: [], ...(result.error ? { error: result.error } : {}) };
    },
  };
  t.after(() => delete ADAPTERS['fake-linger']);
  const notes = [];
  const [result] = await runCommand(root, agentExperiment(root, 'linger', 'fake-linger'), { log: (line) => notes.push(line) });
  assert.notEqual(result.halted, true, notes.join('\n'));
  assert.ok(notes.some((line) => /ended 1 process\(es\) the call left running/.test(line)), notes.join('\n'));
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), 'the grandchild is gone');
});

for (const [label, outcome, pattern] of [
  ['a process that survives being ended', { ended: ['evil:1'], survivors: ['evil:1'], error: null }, /could not end \(evil:1\)/],
  ['a watch that stopped during the call', { ended: [], survivors: [], error: 'the process watch stopped' }, /got past the process watch/],
]) {
  test(`process watch: ${label} halts the run`, async (t) => {
    const { root } = setup(t, { agentic: true });
    setProcessWatch(async () => ({ assign: async () => {}, finish: async () => outcome }));
    t.after(() => setProcessWatch(null));
    fake(t, `fake-watch-${label.length}`, () => 'done');
    const [result] = await runCommand(root, agentExperiment(root, `watch${label.length}`, `fake-watch-${label.length}`), { log: () => {} });
    assert.equal(result.halted, true);
    assert.equal(trustOf(root, result.runId, result.runDir).state, 'halted');
    const row = JSON.parse(fs.readFileSync(path.join(result.runDir, 'raw.jsonl'), 'utf8').split('\n')[0]);
    assert.match(row.error.message, pattern);
  });
}

test('process watch: a watch that cannot start makes no call, and the run resumes', async (t) => {
  const { root } = setup(t, { agentic: true });
  setProcessWatch(async () => {
    throw new Error('no powershell');
  });
  t.after(() => setProcessWatch(null));
  let calls = 0;
  fake(t, 'fake-nowatch', () => {
    calls += 1;
    return 'done';
  });
  const [result] = await runCommand(root, agentExperiment(root, 'nowatch', 'fake-nowatch'), { log: () => {} });
  setProcessWatch(null);
  assert.equal(calls, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(result.runDir, 'run.json'), 'utf8'));
  assert.equal(manifest.harness.settings.halted, undefined);
  assert.equal(manifest.runner.interrupted, true);
  const [resumed] = await runCommand(root, null, { resume: result.runId, log: () => {} });
  assert.equal(resumed.status, 'completed');
  assert.equal(calls, 1);
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
