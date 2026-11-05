// The data folder: runs and annotations live outside git, are shared by every
// worktree, and are read together with the runs committed in results/.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { runCommand } from '../lab/commands/run.mjs';
import { resolveRunDir } from '../lab/commands/score.mjs';
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
  const before = process.env.LAB_DATA;
  process.env.LAB_DATA = data;
  t.after(() => (before == null ? delete process.env.LAB_DATA : (process.env.LAB_DATA = before)));
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
  assert.equal(dataDir(main, { NODE_TEST_CONTEXT: 'child' }), null);
  assert.equal(dataDir(main, { LAB_ROOT: main }), null, 'LAB_ROOT (fixtures, UI work) keeps its own results/');
  fs.writeFileSync(path.join(main, 'lab.local.yaml'), 'data_dir: ""\n');
  assert.throws(() => dataDir(main, {}), /data_dir must be a folder path/);
  fs.writeFileSync(path.join(main, 'lab.local.yaml'), 'data_dir: ./data\n');
  assert.throws(() => dataDir(main, {}), /inside the repository checkout/, 'git clean would delete it');
  assert.throws(() => dataDir(main, { LAB_DATA: path.join(main, 'x') }), /inside the repository checkout/);
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

test('an agent that changes a finished stored run halts the experiment; other runs writing their own folders do not', async (t) => {
  const { root, data } = setup(t, { agentic: true });
  // A finished run in the data folder, and one that another checkout is still writing.
  const [committed] = runDirs(root);
  const finished = path.join(data, 'results', committed.name);
  fs.cpSync(committed.dir, finished, { recursive: true });
  const busy = path.join(data, 'results', '20261105T000000Z__smoke__elsewhere__abcdef');
  fs.mkdirSync(busy, { recursive: true });
  fs.writeFileSync(path.join(busy, 'run.json'), JSON.stringify({ status: 'running' }));
  let calls = 0;
  fake(t, 'fake-tamper', () => {
    calls += 1;
    // Another worktree's run appends rows and starts a new run folder: no halt.
    fs.appendFileSync(path.join(busy, 'raw.jsonl'), '{}\n');
    fs.mkdirSync(path.join(data, 'results', `20261105T00000${calls}Z__smoke__new__abcdef`), { recursive: true });
    if (calls === 2) fs.appendFileSync(path.join(finished, 'raw.jsonl'), '{"planted":true}\n');
    return 'done';
  });
  const file = path.join(root, 'experiments', 'tamper.yaml');
  fs.writeFileSync(file, ['id: tamper', 'suite: agentic', 'prompt: agent-task', 'repeats: 2', 'cases: [agentic-slugify-bug]', 'workdir: isolated', 'access: edit', 'harness: fake-tamper', 'models: [claude-haiku]', 'evaluators:', '  - id: workspace-tests', '    version: "1"', '    dimension: quality', ''].join('\n'));
  const [result] = await runCommand(root, file, { log: () => {} });
  assert.equal(result.halted, true);
  const rows = readJsonl(path.join(result.runDir, 'raw.jsonl')).rows;
  assert.equal(rows[0].error, null, 'the first call only touched other runs');
  assert.equal(rows[1].error.type, 'left_workdir');
  assert.match(rows[1].error.message, new RegExp(`stored run file results/${committed.name}/raw\.jsonl in the data folder`));
  fs.rmSync(busy, { recursive: true, force: true });
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
