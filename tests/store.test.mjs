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
import { appendEntry, ledgerPath, readLedger, trustRun } from '../lab/lib/ledger.mjs';
import { adoptCommand } from '../lab/commands/adopt.mjs';
import { scoreRun } from '../lab/commands/score.mjs';
import { crashInLedger } from './crash.mjs';
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
  assert.equal(readLedger(ledgerPath(root)).problems.length, 1, 'only the torn line is lost');
});

test('the ledger has a lock of its own: a command holding it refuses a run', async (t) => {
  const { root } = setup(t);
  fake(t, 'fake-ledger-lock', () => '4');
  writeLock(path.dirname(ledgerPath(root)), otherRunner(t));
  await assert.rejects(runCommand(root, smokeExperiment(root, 'ledgerlock', 'fake-ledger-lock'), { log: () => {} }), /Another lab command/);
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
