// js-function@2 and workspace-tests@2: the verdict limits are CPU time, so a busy machine does
// not change a verdict. The version-1 evaluators keep their wall-clock limits and their
// tests (tests/evaluators.test.mjs, tests/archive.test.mjs).
//
// A starved process is simulated without loading the machine: Atomics.wait blocks for wall
// time and uses no CPU, exactly what a process sees when other processes take its cores.
// CPU work is sized by a calibration loop, so the numbers hold on a slow or a fast machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { runCommand } from '../lab/commands/run.mjs';
import { scoreRun } from '../lab/commands/score.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';
import { CPU_LIMITS, getEvaluator, loadCheck, runJsTestsV2, runWorkspaceCheckV2 } from '../lab/evaluators/index.mjs';
import { readJsonl } from '../lab/lib/fsutil.mjs';
import { snapshotWorkspace } from '../lab/lib/workspace.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const jsV1 = getEvaluator('js-function', '1');
const jsV2 = getEvaluator('js-function', '2');
const FENCE = '```';
const js = (code) => `${FENCE}js\n${code}\n${FENCE}`;
const reply = (text) => ({ response: { text } });
const oks = (score) => score.details.results.map((item) => item.ok);

const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};

/** Loop count that costs about `ms` of CPU in a vm context on this machine. */
function loopCountFor(ms) {
  const time = (n) => {
    const context = vm.createContext({});
    const fn = vm.runInContext('(function (n) { let s = 0; for (let i = 0; i < n; i += 1) s = (s + i * 7) % 1000003; return s; })', context);
    const started = cpuMs();
    fn(n);
    return cpuMs() - started;
  };
  let n = 1e6;
  let took = time(n);
  while (took < 400) {
    n *= 4;
    took = time(n);
  }
  return Math.round((n * ms) / took);
}
const burn = (count) => `let s = 0; for (let i = 0; i < ${count}; i += 1) s = (s + i * 7) % 1000003;`;
const sleep = (ms) => `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});`;

test('the registry holds both versions of both evaluators, with id, version and dimension', () => {
  for (const id of ['js-function', 'workspace-tests']) {
    for (const version of ['1', '2']) {
      const evaluator = getEvaluator(id, version);
      assert.deepEqual([evaluator.id, evaluator.version, evaluator.dimension], [id, version, 'quality']);
    }
  }
  assert.deepEqual({ ...CPU_LIMITS }, { testCpuMs: 2000, caseCpuMs: 30000, checkCpuMs: 60000, probeMs: 5000, cap: 10 });
});

const primes = {
  input: { name: 'primesUpTo' },
  expected: { tests: [{ args: [10], returns: [2, 3, 5, 7] }, { args: [1], returns: [] }, { args: [2], returns: [2] }] },
};
const SIEVE = 'const out = []; for (let i = 2; i <= n; i++) if (out.every((p) => i % p)) out.push(i); return out;';
const score = (evaluator, text, testCase = primes) => evaluator.score({ raw: reply(text), testCase });

test('js-function@2 gives the same result as @1, in the same shape, for the usual answers', () => {
  const answers = [
    js(`export function primesUpTo(n) { ${SIEVE} }`),
    js(`const primesUpTo = (n) => { ${SIEVE} };`),
    js(`function primesUpTo(n) { ${SIEVE} }\nmodule.exports = { primesUpTo };`),
    js('function primesUpTo(n) { return [2, 3, 5, 7]; }'), // partial credit
    js('function other() {}'), // no such function
    js('function primesUpTo( {'), // syntax error
    js('function primesUpTo(n) { throw new Error("boom"); }'),
    js('function primesUpTo(n) { return undefined; }'),
    js(`function primesUpTo(n) { ${SIEVE} }`) + `\nExample:\n${js('console.log(primesUpTo(10));')}`,
  ];
  for (const text of answers) {
    const one = score(jsV1, text);
    const two = score(jsV2, text);
    assert.equal(two.value, one.value, text.slice(0, 60));
    assert.equal(two.passed, one.passed);
    assert.deepEqual(oks(two), oks(one));
    assert.deepEqual(Object.keys(two).sort(), Object.keys(one).sort());
    assert.deepEqual(Object.keys(two.details).sort(), Object.keys(one.details).sort());
    assert.equal(two.details.error, one.details.error, 'same load error');
    two.details.results.forEach((item, index) => assert.deepEqual(Object.keys(item).sort(), Object.keys(one.details.results[index]).sort()));
  }
  assert.equal(score(jsV2, answers[0]).value, 1);
  assert.equal(jsV2.score({ raw: reply('x'), testCase: { input: {}, expected: {} } }), null, 'a case without tests is not scored');
});

test('js-function@2 keeps the sandbox: no file writes, no child processes, no forged result line', (t) => {
  const marker = path.join(os.tmpdir(), `lab-sandbox-v2-escape-${process.pid}.txt`).replace(/\\/g, '/');
  t.after(() => fs.rmSync(marker, { force: true }));
  const escape = (body) => js(`function primesUpTo(n) {\n  const proc = this.constructor.constructor('return process')();\n  ${body}\n  return [];\n}`);
  const write = score(jsV2, escape(`proc.mainModule.require('fs').writeFileSync('${marker}', 'x');`));
  assert.equal(fs.existsSync(marker), false, 'no file was written');
  assert.match(write.details.results[0].error, /restricted|permission/i);
  const spawn = score(jsV2, escape("proc.mainModule.require('child_process').execSync('echo hi');"));
  assert.match(spawn.details.results[0].error, /restricted|permission/i);
  const forged = JSON.stringify({ loaded: true, results: Array.from({ length: 50 }, () => ({ ok: true, actual_json: '[2,3,5,7]' })) });
  const fake = score(jsV2, escape(`proc.stdout.write('\\n' + ${JSON.stringify(forged)} + '\\n'); proc.exit(0);`));
  assert.equal(fake.value, 0, 'the forged line has no nonce');
  assert.match(fake.details.error, /no result/);
});

test('js-function@2: an endless loop fails its test, and the case still finishes', () => {
  const started = Date.now();
  const looping = score(jsV2, js('function primesUpTo(n) { if (n === 1) while (true) {} return n === 10 ? [2, 3, 5, 7] : [2]; }'));
  assert.deepEqual(oks(looping), [true, false, true]);
  assert.match(looping.details.results[1].error, /backstop/);
  assert.ok(Date.now() - started < 20000, 'the backstop ends the loop');
  const getter = score(jsV2, js('function primesUpTo(n) { return { get x() { while (true) {} } }; }'));
  assert.equal(getter.value, 0);
  assert.match(getter.details.results[0].error, /backstop/);
});

test('js-function@2: a test that uses over 2 s of CPU (sized to 3 s) fails, even on an idle machine', () => {
  const code = js(`function primesUpTo(n) { if (n === 1) { ${burn(loopCountFor(3000))} } return n === 10 ? [2, 3, 5, 7] : n === 1 ? [] : [2]; }`);
  const two = score(jsV2, code);
  assert.deepEqual(oks(two), [true, false, true]);
  assert.match(two.details.results[1].error, /backstop|CPU/);
  assert.deepEqual(oks(score(jsV1, code)), [true, false, true], 'version 1 agrees on an idle machine');
});

test('js-function@2: a test that uses about 1 s of CPU passes', () => {
  const code = js(`function primesUpTo(n) { if (n === 1) { ${burn(loopCountFor(1000))} } return n === 10 ? [2, 3, 5, 7] : n === 1 ? [] : [2]; }`);
  assert.equal(score(jsV2, code).value, 1);
});

test('js-function@2: a starved process (wall time passes, CPU does not) keeps its verdict', () => {
  // The test waits 700 ms of wall time with no CPU, over the 400 ms backstop of a 400 ms CPU limit.
  const limits = { testCpuMs: 400, caseCpuMs: 30000, wallMs: 60000 };
  const tests = [{ args: [1], returns: 1 }, { args: [2], returns: 2 }];
  const run = (code) => runJsTestsV2({ sources: [code], name: 'f', tests, limits });
  const starved = run(`function f(x) { if (x === 2) { ${sleep(700)} } return x; }`);
  assert.deepEqual(starved.results.map((item) => item.ok), [true, true], JSON.stringify(starved.results));
  // A loop is still stopped, whatever the ratio: the backstop is bounded by the cap.
  const looping = run('function f(x) { if (x === 2) while (true) {} return x; }');
  assert.deepEqual(looping.results.map((item) => item.ok), [true, false]);
  assert.match(looping.results[1].error, /backstop/);
});

test('js-function@2: all tests of a case share a CPU budget; past it the rest fail and say why', () => {
  const unit = loopCountFor(250);
  const tests = Array.from({ length: 8 }, (_, i) => ({ args: [i], returns: i }));
  const limits = { testCpuMs: 2000, caseCpuMs: 625, wallMs: 60000 };
  const run = runJsTestsV2({ sources: [`function f(x) { ${burn(unit)} return x; }`], name: 'f', tests, limits });
  const flags = run.results.map((item) => item.ok);
  const firstFailed = flags.indexOf(false);
  assert.ok(firstFailed >= 2 && firstFailed <= 4, `the tests that fit the budget: ${flags.join(',')}`);
  assert.ok(flags.slice(firstFailed).every((ok) => !ok), 'once the budget is spent, no later test passes');
  assert.match(run.results[firstFailed].error, /CPU budget of 625 ms for the case/);
});

test('js-function@2: the wall time of a sleeping test is not charged to the case', () => {
  const tests = Array.from({ length: 6 }, (_, i) => ({ args: [i], returns: i }));
  const run = runJsTestsV2({ sources: [`function f(x) { ${sleep(150)} return x; }`], name: 'f', tests, limits: { testCpuMs: 2000, caseCpuMs: 400, wallMs: 60000 } });
  assert.deepEqual(run.results.map((item) => item.ok), tests.map(() => true), '6 x 150 ms of wall time is over the 400 ms budget; 0 ms of CPU is not');
});

// ---- workspace-tests@2 ----

const temps = [];
test.after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** A small workspace with one hidden check whose probe file is `probeSource`; runs workspace-tests@2's runner. */
function checkWith({ probeSource, expectedProbes, limits }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-v2-'));
  temps.push(dir);
  const fixture = path.join(dir, 'fixture');
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'src', 'value.mjs'), 'export const value = 1;\n');
  const work = path.join(dir, 'work');
  fs.cpSync(fixture, work, { recursive: true });
  fs.writeFileSync(path.join(work, 'src', 'value.mjs'), 'export const value = 2;\n');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  const artifact = snapshotWorkspace({ fixtureDir: fixture, workDir: work, runDir, base: 'w', artifactId: 'x', createdAt: '2026-11-07T00:00:00Z' });
  const checkDir = path.join(dir, 'checks', 'one');
  fs.mkdirSync(checkDir, { recursive: true });
  fs.writeFileSync(path.join(checkDir, 'probe.mjs'), probeSource);
  fs.writeFileSync(path.join(checkDir, 'expected.json'), JSON.stringify({ probes: expectedProbes, files: { 'src/value.mjs': { includes: ['value = 2'] } } }));
  return runWorkspaceCheckV2({ fixtureDir: fixture, check: loadCheck(path.join(dir, 'checks'), 'one'), runDir, manifestPath: artifact.path, limits });
}

test('workspace-tests@2: probes run in the rebuilt workspace and are compared with expected.json, like @1', () => {
  const run = checkWith({
    probeSource: `export const probes = [
      { name: 'value', async run({ load }) { return (await load('src/value.mjs')).value; } },
      { name: 'wrong', run() { return 5; } },
      { name: 'throws', run() { throw new Error('boom'); } },
      { name: 'nothing', run() {} },
    ];\n`,
    expectedProbes: { value: 2, wrong: 6, throws: 1, nothing: null },
  });
  assert.equal(run.error, undefined);
  assert.deepEqual(run.results.map((item) => [item.name, item.ok]), [['file src/value.mjs', true], ['value', true], ['wrong', false], ['throws', false], ['nothing', true]]);
  assert.equal(run.results[2].error, 'expected 6, got 5');
  assert.equal(run.results[3].error, 'boom');
  assert.deepEqual(Object.keys(run).sort(), ['cpu_ms', 'results', 'skipped']);
});

test('workspace-tests@2: the check has a CPU budget, tested between probes; wall time does not count against it', () => {
  const unit = loopCountFor(300);
  const sleepers = Array.from({ length: 4 }, (_, i) => `{ name: 'sleep${i}', run() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); return 1; } }`);
  const burners = Array.from({ length: 5 }, (_, i) => `{ name: 'burn${i}', run() { ${burn(unit)} return 1; } }`);
  const names = [...sleepers, ...burners].map((_, i) => (i < 4 ? `sleep${i}` : `burn${i - 4}`));
  const run = checkWith({
    probeSource: `export const probes = [${[...sleepers, ...burners].join(',\n')}];\n`,
    expectedProbes: Object.fromEntries(names.map((name) => [name, 1])),
    limits: { checkCpuMs: 700, wallMs: 120000 },
  });
  const byName = new Map(run.results.map((item) => [item.name, item]));
  for (let i = 0; i < 4; i += 1) assert.equal(byName.get(`sleep${i}`).ok, true, '1 s of wall time with no CPU is inside a 700 ms CPU budget');
  assert.equal(byName.get('burn0').ok, true, 'the first CPU probe runs');
  const flags = Array.from({ length: 5 }, (_, i) => byName.get(`burn${i}`).ok);
  const firstSkipped = flags.indexOf(false);
  assert.ok(firstSkipped >= 2 && firstSkipped <= 4, `the probes that fit the budget: ${flags.join(',')}`);
  assert.ok(flags.slice(firstSkipped).every((ok) => !ok), 'no probe passes after the budget is spent');
  assert.match(byName.get(`burn${firstSkipped}`).error, /CPU budget of 700 ms for the check was spent before this probe/);
  assert.equal(run.error, undefined, 'the check itself finished');
});

test('workspace-tests@2: a probe that never returns is stopped by the backstop; finished probes keep their results', () => {
  const started = Date.now();
  const run = checkWith({
    probeSource: `export const probes = [
      { name: 'before', run() { return 1; } },
      { name: 'loop', run() { while (true) {} } },
      { name: 'after', run() { return 1; } },
    ];\n`,
    expectedProbes: { before: 1, loop: 1, after: 1 },
    limits: { wallMs: 1500 },
  });
  assert.ok(Date.now() - started < 30000, 'the backstop ends the check');
  assert.match(run.error, /backstop/);
  const byName = new Map(run.results.map((item) => [item.name, item]));
  assert.equal(byName.get('before').ok, true, 'a probe that finished before the stop keeps its result');
  assert.equal(byName.get('loop').ok, false);
  assert.equal(byName.get('after').ok, false);
  assert.equal(byName.get('file src/value.mjs').ok, true, 'file rules do not need the process');
});

test('workspace-tests@2: a probe that waits too long fails by the timer, like @1', () => {
  const run = checkWith({
    probeSource: `export const probes = [
      { name: 'waits', run() { return new Promise((resolve) => setTimeout(() => resolve(1), 5000)); } },
      { name: 'fine', run() { return 1; } },
    ];\n`,
    expectedProbes: { waits: 1, fine: 1 },
    limits: { probeMs: 300, wallMs: 120000 },
  });
  const byName = new Map(run.results.map((item) => [item.name, item]));
  assert.match(byName.get('waits').error, /timed out after/);
  assert.equal(byName.get('fine').ok, true, 'the next probe still runs');
});

test('workspace-tests@2 runs end to end: run, score, validate and re-score give the same scores', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-v2-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(REPO, 'tests', 'fixtures', 'repo'), root, { recursive: true });
  fs.cpSync(path.join(REPO, 'datasets', 'archive', 'agentic'), path.join(root, 'datasets', 'agentic'), { recursive: true });
  fs.cpSync(path.join(REPO, 'prompts', 'agent-task'), path.join(root, 'prompts', 'agent-task'), { recursive: true });
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  const good = ['export function slugify(text) {', "  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');", '}', ''].join(String.fromCharCode(10));
  ADAPTERS['fake-v2'] = {
    name: 'fake-v2',
    kind: 'cli',
    entrypoint: 'headless',
    access_method: 'subscription',
    supports_effort: false,
    edit: { args: ['--let-me-edit'], note: 'fake edit flag' },
    detect: async () => ({ version: '0.0.1' }),
    applied: () => ({}),
    async call({ cwd }) {
      fs.writeFileSync(path.join(cwd, 'src', 'slugify.mjs'), good);
      return { text: 'done', finish_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 }, wall_ms: 5, events: [] };
    },
  };
  t.after(() => delete ADAPTERS['fake-v2']);
  const file = path.join(root, 'experiments', 'fake-v2.yaml');
  fs.writeFileSync(file, ['id: fake-v2', 'suite: agentic', 'prompt: agent-task', 'repeats: 1', 'harness: fake-v2', 'models: [claude-haiku]', 'cases: [agentic-slugify-bug]', 'workdir: isolated', 'access: edit', 'evaluators:', '  - id: workspace-tests', '    version: "2"', '    dimension: quality', ''].join(String.fromCharCode(10)));
  const [result] = await runCommand(root, file, { log: () => {} });
  assert.deepEqual(fs.readdirSync(path.join(result.runDir, 'scores')), ['workspace-tests@2.jsonl']);
  const first = readJsonl(path.join(result.runDir, 'scores', 'workspace-tests@2.jsonl')).rows;
  assert.equal(first.length, 1);
  assert.deepEqual([first[0].evaluator_id, first[0].evaluator_version, first[0].passed, first[0].value], ['workspace-tests', '2', true, 1]);
  assert.deepEqual(validateRepo(root).problems, []);
  const [written] = scoreRun(root, result.runDir);
  assert.equal(written.count, 1, 'scoring the run again writes the version 2 scores');
  const again = readJsonl(path.join(result.runDir, 'scores', 'workspace-tests@2.jsonl')).rows;
  assert.deepEqual(again.map((row) => [row.value, row.passed, row.details.passed_tests]), first.map((row) => [row.value, row.passed, row.details.passed_tests]));
});
