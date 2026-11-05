// Agent tasks end to end with a fake agent: the runner copies the starter
// workspace into the isolated workdir, the "agent" edits files there, the runner
// stores the final workspace, and workspace-tests rebuilds it and runs the hidden
// check in the sandbox. No model calls; runs over a temp repo.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { withExtra } from '../lab/adapters/cli.mjs';
import { runProcess } from '../lab/adapters/process.mjs';
import { agentEnv, mentionsFolder, planExperiment, runCommand } from '../lab/commands/run.mjs';
import { scoreRun } from '../lab/commands/score.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { readJson, readJsonl } from '../lab/lib/fsutil.mjs';
import { WORKSPACE_LIMITS, copyTree, listTree, rebuildWorkspace, snapshotWorkspace } from '../lab/lib/workspace.mjs';
import { loadCheck, runWorkspaceCheck } from '../lab/evaluators/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const FIXTURES = path.join(HERE, 'fixtures', 'repo');

const GOOD_SLUGIFY = [
  'export function slugify(text) {',
  "  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');",
  '}',
  '',
].join('\n');

// The temp repo of the test that runs now, for fake agents that try to reach it.
const rootOf = { current: null };

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-agentic-'));
  rootOf.current = root;
  fs.cpSync(FIXTURES, root, { recursive: true });
  fs.cpSync(path.join(REPO, 'datasets', 'agentic'), path.join(root, 'datasets', 'agentic'), { recursive: true });
  fs.cpSync(path.join(REPO, 'prompts', 'agent-task'), path.join(root, 'prompts', 'agent-task'), { recursive: true });
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  return root;
}

function experiment(root, harness, extra = [], caseId = 'agentic-slugify-bug') {
  const file = path.join(root, 'experiments', `${harness}.yaml`);
  fs.writeFileSync(
    file,
    [
      `id: ${harness}`,
      'suite: agentic',
      'prompt: agent-task',
      'repeats: 1',
      `harness: ${harness}`,
      'models: [claude-haiku]',
      `cases: [${caseId}]`,
      'workdir: isolated',
      'access: edit',
      ...extra,
      'evaluators:',
      '  - id: workspace-tests',
      '    version: "1"',
      '    dimension: quality',
      '',
    ].join('\n'),
  );
  return file;
}

function fakeAgent(name, act) {
  return {
    name,
    kind: 'cli',
    entrypoint: 'headless',
    access_method: 'subscription',
    supports_effort: false,
    edit: { args: ['--let-me-edit'], note: 'fake edit flag' },
    detect: async () => ({ version: '0.0.1' }),
    applied: () => ({}),
    async call({ cwd, access }) {
      const text = act({ cwd, access });
      return { text: text ?? 'done', finish_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 }, wall_ms: 5, events: [] };
    },
  };
}

async function runWith(t, name, act, extra, caseId) {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ADAPTERS[name] = fakeAgent(name, act);
  t.after(() => delete ADAPTERS[name]);
  const [result] = await runCommand(root, experiment(root, name, extra, caseId), { log: () => {} });
  const rows = readJsonl(path.join(result.runDir, 'raw.jsonl')).rows;
  const scoreDir = path.join(result.runDir, 'scores');
  const scoreFile = fs.existsSync(scoreDir) ? fs.readdirSync(scoreDir)[0] : null;
  const scores = scoreFile ? readJsonl(path.join(result.runDir, 'scores', scoreFile)).rows : [];
  return { root, result, rows, scores, manifest: readJson(path.join(result.runDir, 'run.json')) };
}

test('withExtra puts flags before -- and before a final -, else at the end', () => {
  assert.deepEqual(withExtra(['run', '--', 'hi'], ['--x']), ['run', '--x', '--', 'hi']);
  assert.deepEqual(withExtra(['exec', '-'], ['--x']), ['exec', '--x', '-']);
  assert.deepEqual(withExtra(['-p', 'hi'], ['--x']), ['-p', 'hi', '--x']);
  assert.deepEqual(withExtra(['-p', 'hi'], []), ['-p', 'hi']);
});

test('snapshot keeps only changes, and rebuild gives back the final workspace', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-ws-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, 'fixture');
  const work = path.join(dir, 'work');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'src', 'a.mjs'), 'a1\n');
  fs.writeFileSync(path.join(fixture, 'keep.txt'), 'same\n');
  fs.writeFileSync(path.join(fixture, 'gone.txt'), 'bye\n');
  fs.cpSync(fixture, work, { recursive: true });
  fs.writeFileSync(path.join(work, 'src', 'a.mjs'), 'a2\n');
  fs.writeFileSync(path.join(work, 'new.txt'), 'hi\n');
  fs.rmSync(path.join(work, 'gone.txt'));
  fs.mkdirSync(path.join(work, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(work, 'node_modules', 'x', 'i.js'), 'skip\n');

  const artifact = snapshotWorkspace({ fixtureDir: fixture, workDir: work, runDir, base: 'artifacts/c/m/r1/workspace', artifactId: 'c__m__r1__workspace', createdAt: '2026-11-04T00:00:00Z' });
  const manifest = readJson(path.join(runDir, artifact.path));
  assert.deepEqual(manifest.changed.sort(), ['new.txt', 'src/a.mjs']);
  assert.deepEqual(manifest.deleted, ['gone.txt']);
  assert.ok(!fs.existsSync(path.join(runDir, 'artifacts/c/m/r1/workspace/files/keep.txt')), 'unchanged files are not copied');

  const dest = path.join(dir, 'rebuilt');
  rebuildWorkspace({ fixtureDir: fixture, runDir, manifestPath: artifact.path, dest });
  assert.deepEqual(listTree(dest).sort(), ['keep.txt', 'new.txt', 'src/a.mjs']);
  assert.equal(fs.readFileSync(path.join(dest, 'src', 'a.mjs'), 'utf8'), 'a2\n');
});

test('an agent that fixes the bug passes every hidden test; the run records edit access', async (t) => {
  let seen = null;
  const { root, rows, scores, manifest } = await runWith(t, 'fake-fixer', ({ cwd, access }) => {
    seen = { access, starter: fs.readFileSync(path.join(cwd, 'src', 'slugify.mjs'), 'utf8') };
    fs.writeFileSync(path.join(cwd, 'src', 'slugify.mjs'), GOOD_SLUGIFY);
  });
  assert.equal(seen.access, 'edit');
  assert.match(seen.starter, /replace\(\/ \/g/, 'the starter workspace is copied in before the call');
  assert.equal(manifest.harness.settings.access, 'edit');
  assert.deepEqual(manifest.harness.settings.access_flags, ['--let-me-edit']);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].artifacts.some((item) => item.path.endsWith('/workspace.json')));
  assert.equal(scores.length, 1);
  assert.equal(scores[0].value, 1, JSON.stringify(scores[0].details));
  assert.equal(scores[0].passed, true);
  assert.deepEqual(validateRepo(root).problems, []);
});

test('an agent that changes nothing fails the hidden tests', async (t) => {
  const { scores } = await runWith(t, 'fake-idle', () => {});
  assert.equal(scores[0].passed, false);
  assert.ok(scores[0].value < 1);
});

test('agent code cannot forge the result line, and cannot reach files outside the sandbox', async (t) => {
  const secret = path.join(os.tmpdir(), `lab-secret-${process.pid}.txt`);
  fs.writeFileSync(secret, 'top secret');
  t.after(() => fs.rmSync(secret, { force: true }));
  const { scores } = await runWith(t, 'fake-forger', ({ cwd }) => {
    fs.writeFileSync(
      path.join(cwd, 'src', 'slugify.mjs'),
      [
        "import fs from 'node:fs';",
        `let leaked = 'no';`,
        `try { leaked = fs.readFileSync(${JSON.stringify(secret)}, 'utf8'); } catch {}`,
        "process.stdout.write('\\n' + JSON.stringify({ nonce: 'guess', results: [{ name: 'x', ok: true }] }) + '\\n');",
        "export function slugify() { return leaked; }",
        '',
      ].join('\n'),
    );
  });
  assert.equal(scores[0].passed, false);
  assert.ok(scores[0].details.total_tests > 1, 'the forged one-test line was ignored');
  assert.ok(!JSON.stringify(scores[0].details).includes('top secret'), 'the sandbox could not read the secret file');
});

test('validate refuses a workspace case outside an isolated workdir and a missing check', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = experiment(root, 'fake-any');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('workdir: isolated', 'workdir: repo'));
  fs.rmSync(path.join(root, 'datasets', 'agentic', 'checks', 'cart-discount', 'probe.mjs'));
  const problems = validateRepo(root).problems.join('\n');
  assert.match(problems, /workdir must be "isolated"/);
  assert.match(problems, /checks\/cart-discount\/probe\.mjs does not exist/);
  // The runner refuses it too, before any call.
  assert.throws(() => planExperiment(root, file), /workdir: isolated/);
});

test('runProcess points PWD at the working folder, so a CLI that reads PWD starts there', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-pwd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = await runProcess('node', ['-e', 'process.stdout.write(process.env.PWD)'], { cwd: dir, timeoutMs: 20000 });
  assert.equal(path.resolve(run.stdout), path.resolve(dir));
});

test('mentionsFolder matches any slash style and case, and only real folders', () => {
  const folder = path.join(os.tmpdir(), 'Lab', 'Repo');
  // A JSON event as stored: on Windows each backslash of the path is escaped as two.
  assert.equal(mentionsFolder(JSON.stringify({ cmd: `cd "${folder}" && ls` }), [folder]), true);
  assert.equal(mentionsFolder(`cd ${folder.replace(/\\/g, '/').toUpperCase()}/datasets`, [folder]), true);
  assert.equal(mentionsFolder(`cd ${path.join(os.tmpdir(), 'model-lab', 'run')}`, [folder]), false);
  // Git Bash prints W:\Lab\Repo as /w/Lab/Repo.
  if (process.platform === 'win32') assert.equal(mentionsFolder('cd /w/lab/repo && cat x', ['W:\\Lab\\Repo']), true);
});

test('an agent that edits the lab stops the whole experiment, and its run is not scored', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let laterCalls = 0;
  // It edits the evaluator runner, not the suite: the guard covers the lab's code too.
  ADAPTERS['fake-escaper'] = fakeAgent('fake-escaper', () => fs.appendFileSync(path.join(root, 'lab', 'evaluators', 'workspace-check.mjs'), '\n// changed\n'));
  ADAPTERS['fake-next'] = fakeAgent('fake-next', () => {
    laterCalls += 1;
  });
  t.after(() => {
    delete ADAPTERS['fake-escaper'];
    delete ADAPTERS['fake-next'];
  });
  fs.cpSync(path.join(REPO, 'lab'), path.join(root, 'lab'), { recursive: true });
  const file = path.join(root, 'experiments', 'two.yaml');
  fs.writeFileSync(
    file,
    ['id: two', 'suite: agentic', 'prompt: agent-task', 'repeats: 2', 'cases: [agentic-slugify-bug]', 'workdir: isolated', 'access: edit', 'targets:', '  - model: claude-haiku', '    harness: fake-escaper', '  - model: claude-haiku', '    harness: fake-next', 'evaluators:', '  - id: workspace-tests', '    version: "1"', '    dimension: quality', ''].join('\n'),
  );
  const results = await runCommand(root, file, { log: () => {} });
  assert.equal(results.length, 1, 'the next harness never started');
  assert.equal(laterCalls, 0);
  const rows = readJsonl(path.join(results[0].runDir, 'raw.jsonl')).rows;
  assert.equal(rows.length, 1, 'the second repeat never ran');
  assert.equal(rows[0].error.type, 'left_workdir');
  assert.match(rows[0].error.message, /changed lab\/evaluators\/workspace-check\.mjs/);
  assert.equal(readJson(path.join(results[0].runDir, 'run.json')).status, 'failed');
  assert.ok(!fs.existsSync(path.join(results[0].runDir, 'scores')), 'a halted run is not scored');
  // It stays unscored when scored again later, unless forced.
  assert.equal(readJson(path.join(results[0].runDir, 'run.json')).harness.settings.halted, 'left_workdir');
  assert.deepEqual(scoreRun(root, results[0].runDir), []);
  assert.equal(scoreRun(root, results[0].runDir, { force: true }).length, 1);
});

test('the guard covers the whole repository, not only the lab folders', async (t) => {
  const { rows, result } = await runWith(t, 'fake-docs-editor', ({ cwd }) => {
    fs.writeFileSync(path.join(rootOf.current, 'NOTES.md'), 'planted\n');
    fs.writeFileSync(path.join(cwd, 'src', 'slugify.mjs'), GOOD_SLUGIFY);
  });
  assert.equal(rows[0].error?.type, 'left_workdir');
  assert.match(rows[0].error.message, /changed NOTES\.md/);
  assert.match(rows[0].error.message, /false alarm/, 'the message never tells the owner to throw away their own edit');
  assert.equal(result.halted, true);
});

test('a workspace case without access: edit is refused by run and by validate', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = experiment(root, 'fake-any');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('access: edit\n', ''));
  assert.throws(() => planExperiment(root, file), /need access: edit/);
  assert.match(validateRepo(root).problems.join('\n'), /access must be "edit"/);
});

const SOLUTIONS = path.join(HERE, 'fixtures', 'agentic-solutions');

test('every hidden check passes on a known-good solution, so each case can be won', async (t) => {
  for (const name of fs.readdirSync(SOLUTIONS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
    const { scores } = await runWith(t, `fake-solver-${name}`, ({ cwd }) => fs.cpSync(path.join(SOLUTIONS, name), cwd, { recursive: true }), [], `agentic-${name}`);
    assert.equal(scores[0].passed, true, `${name}: ${JSON.stringify(scores[0].details)}`);
  }
});

test('file rules: includes, exists false and same_as_starter each fail when they should', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-rules-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, 'fixture');
  fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'keep.txt'), 'original\n');
  fs.writeFileSync(path.join(fixture, 'notes.txt'), 'hello\n');
  const work = path.join(dir, 'work');
  fs.cpSync(fixture, work, { recursive: true });
  fs.writeFileSync(path.join(work, 'keep.txt'), 'changed\n');
  fs.writeFileSync(path.join(work, 'secret.txt'), 'x\n');
  const runDir = path.join(dir, 'run');
  const artifact = snapshotWorkspace({ fixtureDir: fixture, workDir: work, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-04T00:00:00Z' });
  const checkDir = path.join(dir, 'checks', 'rules');
  fs.mkdirSync(checkDir, { recursive: true });
  fs.writeFileSync(path.join(checkDir, 'probe.mjs'), 'export const probes = [];\n');
  fs.writeFileSync(
    path.join(checkDir, 'expected.json'),
    JSON.stringify({ files: { 'keep.txt': { same_as_starter: true }, 'notes.txt': { includes: ['bye'] }, 'secret.txt': { exists: false }, 'missing.txt': { exists: true } } }),
  );
  const run = runWorkspaceCheck({ fixtureDir: fixture, check: loadCheck(path.join(dir, 'checks'), 'rules'), runDir, manifestPath: artifact.path });
  assert.deepEqual(
    run.results.map((item) => [item.name, item.ok, item.error]),
    [
      ['file keep.txt', false, 'file differs from the starter'],
      ['file notes.txt', false, 'file lacks "bye"'],
      ['file secret.txt', false, 'file should not exist'],
      ['file missing.txt', false, 'file is missing'],
    ],
  );
});

test('a changed starter is reported when scoring, and a link in a starter is refused', async (t) => {
  const { root, result } = await runWith(t, 'fake-fixer3', ({ cwd }) => fs.writeFileSync(path.join(cwd, 'src', 'slugify.mjs'), GOOD_SLUGIFY));
  fs.appendFileSync(path.join(root, 'datasets', 'agentic', 'workspaces', 'slugify-bug', 'package.json'), '\n');
  const lines = [];
  scoreRun(root, result.runDir, { log: (line) => lines.push(line) });
  assert.match(lines.join('\n'), /not scored, its starter project changed/);
  const starter = path.join(root, 'datasets', 'agentic', 'workspaces', 'slugify-bug');
  try {
    fs.symlinkSync(path.join(starter, 'package.json'), path.join(starter, 'link.json'), 'file');
  } catch {
    t.diagnostic('this machine cannot create links; the link half of the test is skipped');
    return;
  }
  assert.throws(() => copyTree(starter, path.join(root, 'copy')), /not a regular file or folder/);
  assert.match(validateRepo(root).problems.join('\n'), /holds link\.json/);
});

test('agentEnv drops variables that point at the repository and OLDPWD, and keeps the rest of PATH', () => {
  const root = path.join(os.tmpdir(), 'Lab', 'Repo');
  const other = path.join(os.tmpdir(), 'bin');
  const env = agentEnv(root, {
    npm_package_json: path.join(root, 'package.json'),
    HOME_THING: os.tmpdir(),
    OLDPWD: root,
    Path: [path.join(root, 'node_modules', '.bin'), other].join(path.delimiter),
  });
  assert.ok('npm_package_json' in env && env.npm_package_json === undefined);
  assert.ok('OLDPWD' in env && env.OLDPWD === undefined);
  assert.ok(!('HOME_THING' in env));
  assert.equal(env.Path, other, 'npm adds <repo>/node_modules/.bin; only that entry goes');
});

test('an agent that forges rows in its own run folder is caught', async (t) => {
  const { rows, result } = await runWith(t, 'fake-forger-row', ({ cwd }) => {
    const runDir = fs.readdirSync(path.join(rootOf.current, 'results')).map((name) => path.join(rootOf.current, 'results', name)).find((dir) => fs.existsSync(path.join(dir, 'run.json')) && readJson(path.join(dir, 'run.json')).status === 'running');
    fs.appendFileSync(path.join(runDir, 'raw.jsonl'), '{"forged":true}\n');
    fs.writeFileSync(path.join(cwd, 'src', 'slugify.mjs'), GOOD_SLUGIFY);
  });
  assert.equal(rows.at(-1).error?.type, 'left_workdir');
  assert.equal(result.halted, true);
});

test('the sandbox has no node:sqlite, which would read and write files past the permission model', async (t) => {
  const { scores } = await runWith(t, 'fake-sqlite', ({ cwd }) => {
    fs.writeFileSync(
      path.join(cwd, 'src', 'slugify.mjs'),
      ["let state = 'blocked';", "try { await import('node:sqlite'); state = 'loaded'; } catch {}", 'export function slugify() { return state; }', ''].join('\n'),
    );
  });
  assert.ok(scores[0].details.results.some((item) => /got "blocked"/.test(item.error ?? '')), JSON.stringify(scores[0].details.results));
});

test('a stored run cannot make the rebuild touch files outside the workspace', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-trav-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, 'fixture');
  fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'a.txt'), 'a\n');
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'keep me\n');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(path.join(runDir, 'w'), { recursive: true });
  for (const bad of [{ deleted: ['../victim.txt'] }, { deleted: ['../../victim.txt'] }, { changed: ['../victim.txt'] }]) {
    fs.writeFileSync(path.join(runDir, 'w', 'workspace.json'), JSON.stringify({ changed: [], deleted: [], ...bad }));
    assert.throws(() => rebuildWorkspace({ fixtureDir: fixture, runDir, manifestPath: 'w/workspace.json', dest: path.join(dir, 'ws') }), /outside the workspace/);
  }
  assert.throws(() => rebuildWorkspace({ fixtureDir: fixture, runDir, manifestPath: '../w/workspace.json', dest: path.join(dir, 'ws2') }), /not inside the run/);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me\n');
});

test('snapshot limits are recorded as skipped, and a folder turned into a file rebuilds', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-lim-'));
  const saved = { ...WORKSPACE_LIMITS };
  t.after(() => {
    Object.assign(WORKSPACE_LIMITS, saved);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const fixture = path.join(dir, 'fixture');
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'src', 'a.mjs'), 'a\n');
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'src'), 'now a file\n');
  fs.writeFileSync(path.join(work, 'big.bin'), Buffer.alloc(64));
  WORKSPACE_LIMITS.fileBytes = 32;
  const runDir = path.join(dir, 'run');
  const artifact = snapshotWorkspace({ fixtureDir: fixture, workDir: work, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-04T00:00:00Z' });
  const manifest = readJson(path.join(runDir, artifact.path));
  assert.deepEqual(manifest.skipped, [{ path: 'big.bin', bytes: 64, reason: 'file too large' }]);
  const dest = path.join(dir, 'ws');
  rebuildWorkspace({ fixtureDir: fixture, runDir, manifestPath: artifact.path, dest });
  assert.equal(fs.readFileSync(path.join(dest, 'src'), 'utf8'), 'now a file\n');
});

test('agent code that patches globals cannot turn a wrong answer into a pass', async (t) => {
  const { scores } = await runWith(t, 'fake-patcher', ({ cwd }) => {
    fs.writeFileSync(
      path.join(cwd, 'src', 'slugify.mjs'),
      [
        "JSON.stringify = () => '\"hello-world\"';",
        "Object.defineProperty(Object.prototype, 'toJSON', { value() { return { nonce: 'x', results: [] }; }, configurable: true });",
        "String.prototype.toJSON = function () { return 'hello-world'; };",
        "globalThis.String = () => 'hello-world';",
        "export function slugify() { return 'wrong'; }",
        '',
      ].join('\n'),
    );
  });
  assert.equal(scores[0].passed, false);
  assert.equal(scores[0].details.passed_tests, 1, JSON.stringify(scores[0].details)); // only the unchanged test file
});

test('a starter project changed since the run gives no score, not a wrong one', async (t) => {
  const { root, result } = await runWith(t, 'fake-fixer2', ({ cwd }) => fs.writeFileSync(path.join(cwd, 'src', 'slugify.mjs'), GOOD_SLUGIFY));
  fs.appendFileSync(path.join(root, 'datasets', 'agentic', 'workspaces', 'slugify-bug', 'package.json'), '\n');
  const [written] = scoreRun(root, result.runDir);
  assert.equal(written.count, 0);
});

test('an agent whose tools name the lab repository gets a left_workdir error', async (t) => {
  ADAPTERS['fake-peeker'] = {
    ...fakeAgent('fake-peeker', () => {}),
    async call() {
      return { text: 'done', finish_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, wall_ms: 1, events: [{ type: 'tool', command: `cat ${rootOf.current}/datasets/agentic/checks/slugify-bug.mjs` }] };
    },
  };
  t.after(() => delete ADAPTERS['fake-peeker']);
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [result] = await runCommand(root, experiment(root, 'fake-peeker'), { log: () => {} });
  const rows = readJsonl(path.join(result.runDir, 'raw.jsonl')).rows;
  assert.equal(rows[0].error.type, 'left_workdir');
  assert.match(rows[0].error.message, /hidden checks/);
});
