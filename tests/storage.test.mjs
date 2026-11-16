import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storageSummary, deleteRun, resetHistory } from '../lab/lib/storage.mjs';
import { adoptRuns, appendEntry, ledgerPath, readLedger, trustRun, runCounts } from '../lab/lib/ledger.mjs';
import { dataDir, paths, runDirs } from '../lab/lib/repo.mjs';
import { LOCK_FILE, storeFolders, takeLocks } from '../lab/lib/lock.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { runCommand } from '../lab/commands/run.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'repo');
let cleanedBytes = 0;

function bytes(dir) {
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink()) return 0;
  return stat.isDirectory() ? fs.readdirSync(dir).reduce((sum, name) => sum + bytes(path.join(dir, name)), 0) : stat.size;
}

function setup(t, { external = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-storage-owned-'));
  const root = path.join(base, 'project');
  fs.cpSync(FIXTURES, root, { recursive: true });
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  const data = external ? path.join(base, 'data') : null;
  if (data) fs.mkdirSync(data);
  const previous = Object.fromEntries(['LAB_DATA', 'LAB_TEST_DATA', 'LAB_ROOT'].map((key) => [key, process.env[key]]));
  delete process.env.LAB_ROOT;
  if (data) process.env.LAB_DATA = process.env.LAB_TEST_DATA = data;
  else {
    delete process.env.LAB_DATA;
    delete process.env.LAB_TEST_DATA;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) value == null ? delete process.env[key] : (process.env[key] = value);
    assert.ok(path.basename(base).startsWith('lab-storage-owned-'));
    assert.equal(path.dirname(base), os.tmpdir());
    cleanedBytes += bytes(base);
    fs.rmSync(base, { recursive: true, force: true });
  });
  return { base, root, data };
}

test.after(() => console.log(`Owned disposable storage roots removed; ${cleanedBytes} bytes freed.`));

test('delete one run removes its exact folder, preserves other scored evidence and records its deletion', (t) => {
  const { root } = setup(t);
  const before = storageSummary(root);
  assert.ok(before.run_count > 1);
  const [chosen, retained] = before.runs;
  assert.ok(chosen.bytes > 0);
  const retainedManifest = fs.readFileSync(path.join(retained.path, 'run.json'));
  const removed = deleteRun(root, chosen.run_id, { confirm: chosen.run_id });
  assert.equal(removed.bytes_deleted, chosen.bytes);
  assert.equal(fs.existsSync(chosen.path), false);
  assert.equal(storageSummary(root).run_count, before.run_count - 1);
  assert.deepEqual(fs.readFileSync(path.join(retained.path, 'run.json')), retainedManifest);
  assert.equal(runCounts(trustRun(readLedger(ledgerPath(root)), retained.run_id, retained.path)), true);
  assert.equal(readLedger(ledgerPath(root)).runs.get(chosen.run_id).deleted, true);
  assert.deepEqual(validateRepo(root).problems, []);
});

test('reset clears both run stores and live/legacy history, preserves inputs and leaves a fresh ledger', (t) => {
  const { root, data } = setup(t, { external: true });
  const [first] = runDirs(root);
  fs.cpSync(first.dir, path.join(data, 'results', first.name), { recursive: true });
  for (const base of [root, data]) {
    for (const name of ['annotations', 'boards', 'reports']) {
      fs.mkdirSync(path.join(base, name), { recursive: true });
      fs.writeFileSync(path.join(base, name, 'history.txt'), 'owner history');
    }
  }
  fs.mkdirSync(path.join(root, '.cache', 'other-session'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cache', 'other-session', 'keep.txt'), 'keep this evidence');
  const input = fs.readFileSync(path.join(root, 'datasets', 'smoke', 'cases.jsonl'));
  const before = storageSummary(root);
  const result = resetHistory(root, { confirm: 'DELETE ALL RUNS' });
  assert.equal(result.run_count, before.run_count);
  assert.ok(result.bytes_deleted >= before.bytes);
  assert.equal(storageSummary(root).run_count, 0);
  assert.equal(fs.readFileSync(ledgerPath(root), 'utf8'), '');
  for (const base of [root, data]) for (const name of ['annotations', 'boards', 'reports']) assert.equal(fs.existsSync(path.join(base, name)), false);
  assert.deepEqual(fs.readFileSync(path.join(root, 'datasets', 'smoke', 'cases.jsonl')), input);
  assert.equal(fs.readFileSync(path.join(root, '.cache', 'other-session', 'keep.txt'), 'utf8'), 'keep this evidence');
  assert.deepEqual(validateRepo(root).problems, []);
});

test('only main-checkout .lab-data is allowed inside a checkout; fixtures keep their ordinary paths', (t) => {
  const { base, root } = setup(t);
  const worktree = path.join(base, 'worktree');
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(root, '.git', 'worktrees', 'test')}\n`);
  fs.mkdirSync(path.join(root, '.git', 'worktrees', 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'worktrees', 'test', 'gitdir'), `${path.join(worktree, '.git')}\n`);
  fs.writeFileSync(path.join(root, 'lab.local.yaml'), 'data_dir: .lab-data\n');
  assert.equal(dataDir(root, {}), path.join(root, '.lab-data'));
  assert.equal(dataDir(worktree, {}), path.join(root, '.lab-data'));
  assert.equal(dataDir(root, { LAB_DATA: path.join(root, '.lab-data') }), path.join(root, '.lab-data'));
  assert.throws(() => dataDir(root, { LAB_DATA: path.join(worktree, '.lab-data') }), /inside the repository checkout/);
  assert.throws(() => dataDir(root, { LAB_DATA: path.join(root, '.lab-data', 'nested') }), /inside the repository checkout/);
  assert.throws(() => dataDir(root, { LAB_DATA: path.join(root, 'datasets') }), /inside the repository checkout/);
  assert.equal(dataDir(root, { LAB_ROOT: root }), null);
  assert.equal(dataDir(root, { NODE_TEST_CONTEXT: 'child' }), null);
  assert.equal(paths(root).boards, path.join(root, 'boards'));
});

test('deletion rejects a filesystem root, a parent folder and Git internals before touching history', (t) => {
  const { base, root } = setup(t);
  const count = runDirs(root).length;
  assert.throws(() => resetHistory(base, { confirm: 'DELETE ALL RUNS' }), /project|root|source/i);
  assert.throws(() => resetHistory(path.parse(root).root, { confirm: 'DELETE ALL RUNS' }), /project|root|source/i);
  const git = path.join(root, '.git');
  fs.mkdirSync(git);
  assert.throws(() => resetHistory(git, { confirm: 'DELETE ALL RUNS' }), /project|root|Git/i);
  assert.equal(runDirs(root).length, count);
});

test('invalid confirmations, traversal and unknown IDs leave every run and ledger untouched', (t) => {
  const { root } = setup(t);
  const before = storageSummary(root);
  const ledger = fs.readFileSync(ledgerPath(root));
  const id = before.runs[0].run_id;
  for (const invalid of ['../datasets', '..', '.', '/tmp/run', 'C:\\data', 'x/y', 'x\\y', 'a:b', 'run.', 'con', 'x\0y']) assert.throws(() => deleteRun(root, invalid, { confirm: invalid }), /Invalid run ID/);
  assert.throws(() => deleteRun(root, id, { confirm: 'yes' }), /Confirm/);
  assert.throws(() => resetHistory(root, { confirm: 'yes' }), /Confirm/);
  assert.throws(() => deleteRun(root, 'missing', { confirm: 'missing' }), /Unknown run ID/);
  assert.equal(storageSummary(root).run_count, before.run_count);
  assert.deepEqual(fs.readFileSync(ledgerPath(root)), ledger);
});

test('an exclusive store lock and a live runner both refuse deletion and reset', (t) => {
  const { root } = setup(t, { external: true });
  const [run] = storageSummary(root).runs;
  const ledger = fs.readFileSync(ledgerPath(root));
  const release = takeLocks(storeFolders(root), { root, command: 'active fake runner' });
  assert.throws(() => deleteRun(root, run.run_id, { confirm: run.run_id }), /run store lock|Another lab command/);
  assert.throws(() => resetHistory(root, { confirm: 'DELETE ALL RUNS' }), /run store lock|Another lab command/);
  release();
  const file = path.join(run.path, 'run.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...manifest, status: 'running', runner: { pid: process.pid, heartbeat_at: new Date().toISOString() } }));
  assert.throws(() => deleteRun(root, run.run_id, { confirm: run.run_id }), /active runner/);
  assert.throws(() => resetHistory(root, { confirm: 'DELETE ALL RUNS' }), /active runner/);
  assert.ok(fs.existsSync(run.path));
  assert.deepEqual(fs.readFileSync(ledgerPath(root)), ledger);
});

test('unknown store entries and takeover folders are preserved and refuse reset', (t) => {
  const { root } = setup(t);
  const ledger = fs.readFileSync(ledgerPath(root));
  const folder = path.join(root, 'results', 'unowned-notes');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'keep.txt'), 'unknown ownership');
  assert.throws(() => resetHistory(root, { confirm: 'DELETE ALL RUNS' }), /Unknown entries/);
  assert.equal(fs.readFileSync(path.join(folder, 'keep.txt'), 'utf8'), 'unknown ownership');
  assert.deepEqual(fs.readFileSync(ledgerPath(root)), ledger);
  const mutex = path.join(root, `${LOCK_FILE}.takeover`);
  fs.mkdirSync(mutex);
  fs.writeFileSync(path.join(mutex, 'unknown.txt'), 'preserve');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(mutex, old, old);
  const [run] = runDirs(root);
  assert.throws(() => deleteRun(root, run.name, { confirm: run.name }), /takeover/i);
  assert.equal(fs.readFileSync(path.join(mutex, 'unknown.txt'), 'utf8'), 'preserve');
});

test('links within a run, linked store roots and hard links refuse deletion without changing their target', (t) => {
  const { root, base } = setup(t);
  const [run] = runDirs(root);
  const victim = path.join(base, 'outside');
  fs.mkdirSync(victim);
  fs.writeFileSync(path.join(victim, 'keep.txt'), 'outside data');
  const planted = path.join(run.dir, 'outside');
  fs.symlinkSync(victim, planted, 'junction');
  assert.throws(() => deleteRun(root, run.name, { confirm: run.name }), /link|junction/);
  assert.throws(() => resetHistory(root, { confirm: 'DELETE ALL RUNS' }), /link|junction/);
  fs.unlinkSync(planted);
  fs.linkSync(path.join(victim, 'keep.txt'), path.join(run.dir, 'hard-link.txt'));
  assert.throws(() => deleteRun(root, run.name, { confirm: run.name }), /one link/);
  fs.unlinkSync(path.join(run.dir, 'hard-link.txt'));
  const linkedData = path.join(base, 'linked-data');
  fs.symlinkSync(victim, linkedData, 'junction');
  process.env.LAB_DATA = process.env.LAB_TEST_DATA = linkedData;
  assert.throws(() => resetHistory(root, { confirm: 'DELETE ALL RUNS' }), /link|junction/);
  assert.equal(fs.readFileSync(path.join(victim, 'keep.txt'), 'utf8'), 'outside data');
});

test('deleting a duplicated run removes both copies and a restored copy stays untrusted', (t) => {
  const { root, base, data } = setup(t, { external: true });
  const [run] = runDirs(root);
  const backup = path.join(base, 'synthetic-restore');
  fs.cpSync(run.dir, backup, { recursive: true });
  fs.cpSync(run.dir, path.join(data, 'results', run.name), { recursive: true });
  const before = storageSummary(root);
  assert.equal(before.runs.find((item) => item.run_id === run.name).paths.length, 2);
  deleteRun(root, run.name, { confirm: run.name });
  assert.equal(fs.existsSync(run.dir), false);
  assert.equal(fs.existsSync(path.join(data, 'results', run.name)), false);
  fs.cpSync(backup, run.dir, { recursive: true });
  assert.equal(runCounts(trustRun(readLedger(ledgerPath(root)), run.name, run.dir)), false);
  assert.throws(() => adoptRuns(ledgerPath(root), [run]), /deliberately deleted/);
  appendEntry(ledgerPath(root), { kind: 'open', run_id: run.name });
  const restored = readLedger(ledgerPath(root));
  assert.equal(restored.runs.get(run.name).deleted, true);
  assert.ok(restored.problems.some((problem) => /was deleted/.test(problem.message)));
});

test('a partial Windows deletion error reports removed bytes and leaves all remnants untrusted', (t) => {
  const { root } = setup(t);
  const before = storageSummary(root);
  const ledgerBefore = fs.readFileSync(ledgerPath(root));
  const first = before.runs[0];
  const remove = fs.rmSync;
  t.mock.method(fs, 'rmSync', function removeWithFailure(file, options) {
    if (file === first.path) {
      const raw = path.join(file, 'raw.jsonl');
      remove.call(this, raw, { force: false });
      throw Object.assign(new Error('EPERM: file is open in another application'), { code: 'EPERM' });
    }
    return remove.call(this, file, options);
  });
  let failure;
  try { resetHistory(root, { confirm: 'DELETE ALL RUNS' }); } catch (error) { failure = error; }
  t.mock.restoreAll();
  assert.equal(failure?.code, 'EPERM');
  assert.ok(failure.partial.bytes_deleted > 0);
  assert.equal(failure.partial.incomplete[0].path, first.path);
  assert.ok(failure.partial.incomplete[0].remaining_bytes > 0);
  assert.notDeepEqual(fs.readFileSync(ledgerPath(root)), ledgerBefore);
  assert.ok(fs.readFileSync(ledgerPath(root), 'utf8').length > 0, 'the failed reset did not clear the ledger');
  for (const run of before.runs) assert.equal(runCounts(trustRun(readLedger(ledgerPath(root)), run.run_id, run.path)), false);
  resetHistory(root, { confirm: 'DELETE ALL RUNS' });
  assert.equal(storageSummary(root).run_count, 0);
});

test('a new fake-harness run after reset is local, counted and valid without adopting old history', async (t) => {
  const { root } = setup(t);
  const data = path.join(root, '.lab-data');
  process.env.LAB_DATA = process.env.LAB_TEST_DATA = data;
  resetHistory(root, { confirm: 'DELETE ALL RUNS' });
  ADAPTERS['fake-storage'] = {
    name: 'fake-storage', kind: 'cli', entrypoint: 'headless', access_method: 'subscription', supports_effort: false,
    detect: async () => ({ version: '1.0.0' }), applied: () => ({}),
    call: async () => ({ text: '4', finish_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, wall_ms: 1, events: [] }),
  };
  t.after(() => delete ADAPTERS['fake-storage']);
  const experiment = path.join(root, 'experiments', 'fresh-storage.yaml');
  fs.writeFileSync(experiment, ['id: fresh-storage', 'suite: smoke', 'prompt: qa-single-turn', 'repeats: 1', 'cases: [smoke-001]', 'harness: fake-storage', 'models: [claude-haiku]', 'evaluators:', '  - id: exact-match', '    version: "1"', '    dimension: quality', ''].join('\n'));
  const [run] = await runCommand(root, experiment, { log: () => {} });
  assert.equal(path.dirname(run.runDir), path.join(data, 'results'));
  assert.equal(run.status, 'completed');
  assert.equal(storageSummary(root).run_count, 1);
  assert.equal(readLedger(ledgerPath(root)).runs.size, 1);
  assert.equal(runCounts(trustRun(readLedger(ledgerPath(root)), run.runId, run.runDir)), true);
  assert.deepEqual(validateRepo(root).problems, []);
  assert.equal(paths(root).boards, path.join(data, 'boards'));
  assert.equal(paths(root).reports, path.join(data, 'reports'));
});

test('a failed reset can retry a tombstoned run even after the OS deleted its manifest', (t) => {
  const { root } = setup(t);
  const [run] = storageSummary(root).runs;
  const remove = fs.rmSync;
  t.mock.method(fs, 'rmSync', function removeWithMissingManifest(file, options) {
    if (file === run.path) {
      remove.call(this, path.join(file, 'run.json'), { force: false });
      throw Object.assign(new Error('EBUSY: an artifact remains open'), { code: 'EBUSY' });
    }
    return remove.call(this, file, options);
  });
  assert.throws(() => resetHistory(root, { confirm: 'DELETE ALL RUNS' }), /EBUSY/);
  t.mock.restoreAll();
  assert.equal(readLedger(ledgerPath(root)).runs.get(run.run_id).deleted, true);
  const summary = storageSummary(root);
  assert.ok(summary.runs.some((item) => item.run_id === run.run_id));
  assert.equal(summary.unknown.length, 0);
  resetHistory(root, { confirm: 'DELETE ALL RUNS' });
  assert.equal(storageSummary(root).run_count, 0);
});

test('a peer checkout with stored runs refuses reset so its shared ledger stays valid', (t) => {
  const { base, root } = setup(t);
  const worktree = path.join(base, 'peer');
  const [run] = runDirs(root);
  fs.cpSync(run.dir, path.join(worktree, 'results', run.name), { recursive: true });
  fs.mkdirSync(path.join(root, '.git', 'worktrees', 'peer'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'worktrees', 'peer', 'gitdir'), `${path.join(worktree, '.git')}\n`);
  const ledger = fs.readFileSync(ledgerPath(root));
  assert.throws(() => resetHistory(root, { confirm: 'DELETE ALL RUNS' }), /another checkout/);
  assert.deepEqual(fs.readFileSync(ledgerPath(root)), ledger);
  assert.ok(fs.existsSync(path.join(worktree, 'results', run.name, 'raw.jsonl')));
});

test('a history folder created during reset prevents clearing the evidence ledger', (t) => {
  const {root} = setup(t);
  const reports = paths(root).reports;
  fs.rmSync(reports, {recursive:true, force:true});
  const remove = fs.rmSync;
  let planted = false;
  t.mock.method(fs, 'rmSync', function concurrentHistory(file, options) {
    const result = remove.call(this, file, options);
    if (!planted) { planted = true; fs.mkdirSync(reports, {recursive:true}); fs.writeFileSync(path.join(reports,'new.md'),'Independent report writer'); }
    return result;
  });
  assert.throws(() => resetHistory(root, {confirm:'DELETE ALL RUNS'}), /reappeared|changed during reset/);
  t.mock.restoreAll();
  assert(fs.readFileSync(ledgerPath(root),'utf8').length > 0);
  assert.equal(fs.readFileSync(path.join(reports,'new.md'),'utf8'),'Independent report writer');
});
