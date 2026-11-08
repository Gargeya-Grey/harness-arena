// node lab audit: the mutation sites, the audit of the hidden checks and the stability of scores.
// No model call. Every audit runs through the real command line (node lab audit ...) against a
// small fixture suite in a temporary data root, or against the real ladder suites for one task.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureLedger } from '../lab/lib/ledger.mjs';
import { applyMutation, mutationSites, pickSites } from '../lab/lib/mutate.mjs';
import { loadSuite } from '../lab/lib/repo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const CLI = path.join(REPO, 'lab', 'cli.mjs');

const temps = [];
test.after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempRoot(prefix = 'lab-audit-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** Write { 'relative/path': text } under a folder. */
function put(base, files) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(base, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

function lab(root, args) {
  const env = { ...process.env, LAB_ROOT: root };
  delete env.LAB_DATA;
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 280_000 });
  return { code: run.status, out: run.stdout, err: run.stderr };
}

/** Every file under a folder with its hash, to prove that a command wrote nothing. */
function listing(dir) {
  const out = {};
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(abs, entry.name), next);
      else out[next] = crypto.createHash('sha256').update(fs.readFileSync(path.join(abs, entry.name))).digest('hex');
    }
  };
  walk(dir, '');
  return out;
}

const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
const codeCase = (id, name, tests) => ({ case_id: id, input: { name, signature: `${name}(x)`, task: 'fixture' }, expected: { tests }, tags: ['tier-1-easy'], metadata: { tier: { level: 1 } } });
const ADULT = 'export function isAdult(age) {\n  return age >= 18;\n}\n';
const suiteYaml = (id, version, extra = '') => `id: ${id}\nversion: "${version}"\ndescription: fixture\naudit:\n  references: checks/references\n  file: "<case_id>.mjs"\n${extra}`;

// ---- mutation sites ---------------------------------------------------------------------------

test('a string, a comment, a template text and a regular expression are never mutated', () => {
  const source = [
    '// if (a < b) return true',
    'const s = "a <= b && true";',
    "const t = 'x === y';",
    'const re = /a<b|c>d/g;',
    'const u = `x < ${a > b} y || z`;',
    '/* false && true */',
    'export function f(a, b) { return a <= b; }',
  ].join('\n');
  const sites = mutationSites(source);
  assert.deepEqual(sites.map((site) => [site.line, site.operator, site.from, site.to]), [
    [5, '> -> >=', '>', '>='],
    [7, '<= -> <', '<=', '<'],
  ]);
  assert.equal(sites[1].code, 'export function f(a, b) { return a <= b; }');
  for (const site of sites) assert.equal(source.slice(site.at, site.at + site.from.length), site.from);
});

test('a division is not a regular expression, and a nested template keeps its code visible', () => {
  const source = 'const half = total / 2; const q = a < b ? `${c > d ? `${e >= f}` : 0}` : 1; const r = x / y / z;';
  assert.deepEqual(mutationSites(source).map((site) => site.operator), ['< -> <=', '> -> >=', '>= -> >']);
});

test('a slash after the closing parenthesis of if, while, for or with starts a regular expression; after any other parenthesis it divides', () => {
  const source = [
    'if (ok) /a<b/.test(s);',
    'while (n) /c>d/.exec(s);',
    'for (;;) /e&&f/.test(s);',
    'for await (const x of xs) /g||h/.test(x);',
    'const half = (x - y) / 2 < z;',
    'const call = f(x) / 2 > w;',
  ].join('\n');
  assert.deepEqual(mutationSites(source).map((site) => [site.line, site.operator]), [[5, '< -> <='], [6, '> -> >=']]);
});

test('applyMutation changes only the named site, and refuses a site from another source', () => {
  const source = 'let n = 0;\nif (n >= 1 && ok) n += 1;\n';
  const sites = mutationSites(source);
  assert.deepEqual(sites.map((site) => site.operator), ['>= -> >', '&& -> ||', '+= -> -=']);
  assert.equal(applyMutation(source, sites[1]), 'let n = 0;\nif (n >= 1 || ok) n += 1;\n');
  assert.throws(() => applyMutation('let m = 0;', sites[0]), /is not in this source/);
});

test('pickSites spreads evenly, keeps all when there are few, and repeats', () => {
  const sites = Array.from({ length: 10 }, (_, i) => ({ at: i }));
  assert.deepEqual(pickSites(sites, 4).map((site) => site.at), [0, 2, 5, 7]);
  assert.equal(pickSites(sites, 10), sites);
  assert.deepEqual(pickSites(sites, 4), pickSites(sites, 4));
});

// ---- audit checks: a code suite ---------------------------------------------------------------

const codeRoot = tempRoot();
const CODE_CASES = [
  codeCase('fx-code-adult', 'isAdult', [{ args: [30], returns: true }, { args: [5], returns: false }, { args: [18], returns: true }]),
  codeCase('fx-code-adult-weak', 'isAdult', [{ args: [30], returns: true }, { args: [5], returns: false }]),
  codeCase('fx-code-stale', 'isAdult', [{ args: [18], returns: false }, { args: [30], returns: true }]),
  codeCase('fx-code-noref', 'isAdult', [{ args: [18], returns: true }]),
  codeCase('fx-code-load', 'third', [{ args: [], returns: 3 }]),
  codeCase('fx-code-nosite', 'one', [{ args: [], returns: 1 }]),
];
put(codeRoot, {
  'datasets/fx-code/suite.yaml': suiteYaml('fx-code', '1.0.0'),
  'datasets/fx-code/cases.jsonl': jsonl(CODE_CASES),
  'datasets/fx-code/checks/references/fx-code-adult.mjs': ADULT,
  'datasets/fx-code/checks/references/fx-code-adult-weak.mjs': ADULT,
  'datasets/fx-code/checks/references/fx-code-stale.mjs': ADULT,
  'datasets/fx-code/checks/references/fx-code-load.mjs': // A throw before the definition: the sandbox keeps a hoisted function, but not a const.
  "const table = [1, 2, 3];\nif (table.length < 3) throw new Error('the table is too short');\nexport const third = () => table[2];\n",
  'datasets/fx-code/checks/references/fx-code-nosite.mjs': 'export function one() {\n  return 1;\n}\n',
});
const before = listing(codeRoot);
const codeRun = lab(codeRoot, ['audit', 'checks', '--suite', 'fx-code', '--suite-version', '1.0.0', '--json']);
const code = codeRun.code === 0 ? JSON.parse(codeRun.out) : null;
const task = (id) => code.tasks.find((item) => item.case_id === id);

test('audit checks runs and writes nothing without --write', () => {
  assert.equal(codeRun.code, 0, codeRun.err);
  assert.deepEqual(listing(codeRoot), before);
  assert.deepEqual(code.suite, { id: 'fx-code', version: '1.0.0', sha256: loadSuite(codeRoot, 'fx-code').sha256, frozen: false });
});

test('a mutant that the check kills counts as a kill, with the share of the score it keeps', () => {
  const killed = task('fx-code-adult');
  assert.deepEqual([killed.status, killed.sites, killed.mutants, killed.killed, killed.survived, killed.kill_rate, killed.mean_score_of_killed], ['audited', 1, 1, 1, 0, 1, 0.667]);
  assert.deepEqual(killed.results.map((mutant) => [mutant.line, mutant.operator, mutant.outcome, mutant.pass, mutant.total]), [[2, '>= -> >', 'killed', 2, 3]]);
});

test('a survivor is reported, and a check with one test removed has a survivor where the full check had none', () => {
  const weak = task('fx-code-adult-weak');
  assert.deepEqual([weak.mutants, weak.killed, weak.survived, weak.kill_rate], [1, 0, 1, 0]);
  assert.deepEqual(code.survivors, [{ case_id: 'fx-code-adult-weak', line: 2, operator: '>= -> >', code: 'return age >= 18;' }]);
  assert.equal(task('fx-code-adult').survived, 0);
});

test('a reference that fails the tests of this version is excluded with the reason, and is never a kill', () => {
  const stale = task('fx-code-stale');
  assert.equal(stale.status, 'excluded');
  assert.equal(stale.reason, 'reference does not match this version');
  assert.equal(stale.detail, 'the reference passes 1 of 2 tests');
  assert.equal(stale.mutants, undefined);
  assert.ok(stale.reference.sha256);
});

test('a task without a reference, and one without a mutation site, are excluded with their reason', () => {
  assert.deepEqual([task('fx-code-noref').status, task('fx-code-noref').reason], ['excluded', 'no reference solution']);
  assert.deepEqual([task('fx-code-nosite').status, task('fx-code-nosite').reason], ['excluded', 'no mutation site in the reference']);
});

test('a mutant that does not load is excluded with its reason and is not a kill, and a task whose mutants were all excluded is excluded, not audited', () => {
  const load = task('fx-code-load');
  assert.deepEqual([load.status, load.reason, load.mutants, load.killed, load.excluded_mutants, load.kill_rate], ['excluded', 'no mutant gave a verdict', 0, 0, 1, null]);
  const mutant = code.exclusions.find((item) => item.scope === 'mutant');
  assert.equal(mutant.case_id, 'fx-code-load');
  assert.match(mutant.reason, /the table is too short/);
});

test('the report totals, operators and exclusions add up', () => {
  assert.deepEqual(code.totals, { tasks: 6, audited: 2, excluded: 4, mutants: 2, killed: 1, killed_by_check: 1, killed_by_timeout: 0, survived: 1, excluded_mutants: 1, kill_rate: 0.5, mean_score_of_killed: 0.667 });
  assert.deepEqual(code.operators, [{ operator: '>= -> >', mutants: 2, killed: 1, survived: 1, kill_rate: 0.5 }]);
  assert.deepEqual(code.exclusions.map((item) => [item.scope, item.case_id]), [['task', 'fx-code-stale'], ['task', 'fx-code-noref'], ['task', 'fx-code-load'], ['task', 'fx-code-nosite'], ['mutant', 'fx-code-load']]);
});

test('the report records the hash of each reference it used', () => {
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  assert.equal(task('fx-code-adult').reference.sha256, sha(ADULT));
  assert.equal(task('fx-code-adult').reference.path, 'datasets/fx-code/checks/references/fx-code-adult.mjs');
});

test('the text report names the kill rate, the survivors and the exclusions', () => {
  const run = lab(codeRoot, ['audit', 'checks', '--suite', 'fx-code', '--suite-version', '1.0.0', '--cases', 'fx-code-adult-weak,fx-code-stale']);
  assert.equal(run.code, 0, run.err);
  assert.match(run.out, /1 of 2 tasks audited, 1 excluded/);
  assert.match(run.out, /kill rate 0\.000/);
  assert.match(run.out, /excluded: reference does not match this version \(the reference passes 1 of 2 tests\)/);
  assert.match(run.out, /fx-code-adult-weak line 2 >= -> >  return age >= 18;/);
});

test('--write stores the result under reports/audit/<suite>@<version>.json, and --max limits the mutants', () => {
  const root = tempRoot();
  fs.cpSync(codeRoot, root, { recursive: true });
  const run = lab(root, ['audit', 'checks', '--suite', 'fx-code', '--suite-version', '1.0.0', '--max', '1', '--write']);
  assert.equal(run.code, 0, run.err);
  assert.match(run.out, /Written: reports\/audit\/fx-code@1\.0\.0\.json/);
  const stored = JSON.parse(fs.readFileSync(path.join(root, 'reports', 'audit', 'fx-code@1.0.0.json'), 'utf8'));
  assert.equal(stored.max_per_task, 1);
  assert.deepEqual([stored.suite.id, stored.suite.version, stored.totals.mutants], ['fx-code', '1.0.0', 2]);
  assert.deepEqual(fs.readdirSync(path.join(root, 'reports', 'audit')), ['fx-code@1.0.0.json']);
});

test('--write together with --cases is refused, because a filtered audit would replace the report of the whole suite', () => {
  const root = tempRoot();
  fs.cpSync(codeRoot, root, { recursive: true });
  const run = lab(root, ['audit', 'checks', '--suite', 'fx-code', '--suite-version', '1.0.0', '--cases', 'fx-code-adult', '--write']);
  assert.notEqual(run.code, 0);
  assert.match(run.err, /--write stores the audit of the whole suite; it cannot be used with --cases/);
  assert.equal(run.out, '');
  assert.equal(fs.existsSync(path.join(root, 'reports')), false);
});

test('--write refuses a suite id or version with a path separator or "..", and writes nothing outside reports/audit/', () => {
  const root = tempRoot();
  const base = path.join(root, 'sandbox');
  put(base, {
    'datasets/fx-path/suite.yaml': 'id: fx-path\nversion: "1.0.0/../../../../escape"\n',
    'datasets/fx-path/cases.jsonl': jsonl([CODE_CASES[0]]),
  });
  const run = lab(base, ['audit', 'checks', '--suite', 'fx-path', '--suite-version', '1.0.0/../../../../escape', '--write']);
  assert.notEqual(run.code, 0);
  assert.match(run.err, /version "1\.0\.0\/\.\.\/\.\.\/\.\.\/\.\.\/escape" has a path separator or "\.\.", so no report can be stored for it/);
  assert.deepEqual(fs.readdirSync(root), ['sandbox']);
  assert.equal(fs.existsSync(path.join(base, 'reports')), false);
});

test('--write refuses to write through a link at reports/audit, and leaves the target of the link alone', () => {
  const root = tempRoot();
  fs.cpSync(codeRoot, root, { recursive: true });
  const outside = tempRoot('lab-audit-outside-');
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'reports', 'audit'), 'junction');
  const write = lab(root, ['audit', 'checks', '--suite', 'fx-code', '--suite-version', '1.0.0', '--write']);
  assert.notEqual(write.code, 0);
  assert.match(write.err, /reports\/audit is a link; the report is not written through a link/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

// ---- audit checks: what counts as a kill --------------------------------------------------------

const COUNT_LOOP = 'export function count() {\n  let n = 0;\n  for (let i = 0; i < 3; i += 1) {\n    n = n + 1;\n  }\n  return n;\n}\n';
// `scale` is hoisted, so it survives a throw at the top; `factor` is not set yet when the throw happens.
const HOISTED_THROW = 'const base = 2;\nif (base < 2) throw new Error(\'base too small\');\nconst factor = base * 5;\nexport function scale(x) {\n  return x * factor;\n}\n';
const FLAKY = 'export function coin() {\n  return Math.random() < 0.5;\n}\n';
const judgeRoot = tempRoot();
put(judgeRoot, {
  'datasets/fx-judge/suite.yaml': suiteYaml('fx-judge', '1.0.0'),
  'datasets/fx-judge/cases.jsonl': jsonl([
    codeCase('fx-judge-count', 'count', [{ args: [], returns: 3 }]),
    codeCase('fx-judge-scale', 'scale', [{ args: [1], returns: 10 }]),
    // Two runs of the reference agree on all twenty tests only about once in a million tries.
    codeCase('fx-judge-flaky', 'coin', Array.from({ length: 20 }, () => ({ args: [], returns: true }))),
  ]),
  'datasets/fx-judge/checks/references/fx-judge-count.mjs': COUNT_LOOP,
  'datasets/fx-judge/checks/references/fx-judge-scale.mjs': HOISTED_THROW,
  'datasets/fx-judge/checks/references/fx-judge-flaky.mjs': FLAKY,
});
const judgeRun = lab(judgeRoot, ['audit', 'checks', '--suite', 'fx-judge', '--suite-version', '1.0.0', '--json']);
const judge = judgeRun.code === 0 ? JSON.parse(judgeRun.out) : null;
const judged = (id) => judge.tasks.find((item) => item.case_id === id);

test('a mutant that a test rejected and one that ran out of time are both kills, counted apart', () => {
  assert.equal(judgeRun.code, 0, judgeRun.err);
  const count = judged('fx-judge-count');
  assert.deepEqual(count.results.map((mutant) => [mutant.operator, mutant.outcome, mutant.killed_by]), [
    ['< -> <=', 'killed', 'check'],
    ['+= -> -=', 'killed', 'timeout'],
    ['+ 1 -> + 2', 'killed', 'check'],
  ]);
  assert.deepEqual([count.mutants, count.killed, count.killed_by_check, count.killed_by_timeout, count.kill_rate], [3, 3, 2, 1, 1]);
  assert.deepEqual([judge.totals.killed, judge.totals.killed_by_check, judge.totals.killed_by_timeout], [3, 2, 1]);
});

test('a mutant that throws while it loads is excluded, even when its function survives the throw (hoisted)', () => {
  const scale = judged('fx-judge-scale');
  assert.deepEqual([scale.status, scale.reason, scale.mutants, scale.killed, scale.excluded_mutants], ['excluded', 'no mutant gave a verdict', 0, 0, 1]);
  assert.deepEqual(scale.results.map((mutant) => [mutant.operator, mutant.outcome, mutant.reason]), [['< -> <=', 'excluded', 'the mutant throws while it loads, so its tests did not judge the code that was planted']]);
  assert.equal(judge.exclusions.filter((item) => item.scope === 'mutant' && item.case_id === 'fx-judge-scale').length, 1);
});

test('a reference that does not give the same result twice is excluded as not deterministic', () => {
  const flaky = judged('fx-judge-flaky');
  assert.deepEqual([flaky.status, flaky.reason, flaky.mutants], ['excluded', 'reference not deterministic', undefined]);
  assert.deepEqual([judge.totals.tasks, judge.totals.audited, judge.totals.excluded], [3, 1, 2]);
});

test('a test that never ran, or whose process died, gave no verdict; a timeout is told apart from a rejection', async () => {
  const { judgeResults } = await import('../lab/commands/audit.mjs');
  const ok = { ok: true };
  const wrong = { ok: false, actual: 5 };
  const threw = { ok: false, error: 'x is not defined' };
  const slow = { ok: false, error: 'stopped by the wall-clock backstop after 2000 ms (1900 ms of CPU)' };
  const spent = { ok: false, error: 'the CPU budget of 4000 ms for the case was spent before this test' };
  const died = { ok: false, error: 'this test stopped the sandbox process. sandbox gave no result (exit 134): FATAL ERROR' };
  const none = { ok: false, error: 'no result for this test' };
  assert.deepEqual(judgeResults([ok, ok]), { outcome: 'survived' });
  assert.deepEqual(judgeResults([ok, wrong]), { outcome: 'killed', killed_by: 'check' });
  assert.deepEqual(judgeResults([ok, threw]), { outcome: 'killed', killed_by: 'check' });
  assert.deepEqual(judgeResults([slow, ok]), { outcome: 'killed', killed_by: 'timeout' });
  assert.deepEqual(judgeResults([slow, wrong]), { outcome: 'killed', killed_by: 'check' });
  assert.deepEqual(judgeResults([slow, spent, spent]), { outcome: 'killed', killed_by: 'timeout' });
  assert.deepEqual(judgeResults([ok, spent, spent]), { outcome: 'excluded', reason: 'no test judged this mutant: the CPU budget of 4000 ms for the case was spent before this test' });
  assert.deepEqual(judgeResults([died, ok]), { outcome: 'excluded', reason: 'no test judged this mutant: this test stopped the sandbox process. sandbox gave no result (exit 134): FATAL ERROR' });
  assert.deepEqual(judgeResults([none]), { outcome: 'excluded', reason: 'no test judged this mutant: no result for this test' });
});

// ---- audit checks: the exact version -----------------------------------------------------------

test('a frozen copy whose suite.yaml names another version is refused, and so is a copy whose hash differs from the hash the runs recorded', () => {
  const root = tempRoot();
  put(root, {
    'datasets/fx-copy/suite.yaml': suiteYaml('fx-copy', '2.0.0'),
    'datasets/fx-copy/cases.jsonl': jsonl([codeCase('fx-copy-adult', 'isAdult', [{ args: [18], returns: true }])]),
    'datasets/fx-copy/checks/references/fx-copy-adult.mjs': ADULT,
    'datasets/fx-copy/versions/1.0.0/suite.yaml': suiteYaml('fx-copy', '1.1.0'),
    'datasets/fx-copy/versions/1.0.0/cases.jsonl': jsonl([codeCase('fx-copy-adult', 'isAdult', [{ args: [18], returns: true }])]),
    'datasets/fx-copy/versions/1.0.0/checks/references/fx-copy-adult.mjs': ADULT,
    'datasets/fx-copy/versions/1.2.0/suite.yaml': suiteYaml('fx-copy', '1.2.0'),
    'datasets/fx-copy/versions/1.2.0/cases.jsonl': jsonl([codeCase('fx-copy-adult', 'isAdult', [{ args: [18], returns: true }])]),
    'datasets/fx-copy/versions/1.2.0/checks/references/fx-copy-adult.mjs': ADULT,
  });
  const mislabelled = lab(root, ['audit', 'checks', '--suite', 'fx-copy', '--suite-version', '1.0.0', '--json']);
  assert.notEqual(mislabelled.code, 0);
  assert.match(mislabelled.err, /The frozen copy of fx-copy 1\.0\.0 says it is version 1\.1\.0/);
  assert.equal(mislabelled.out, '');
  const recorded = 'ab'.repeat(32);
  const runId = '20261108T000000Z__fx-copy__fx__aaaaaa';
  put(root, { [`results/${runId}/run.json`]: JSON.stringify({ run_id: runId, status: 'completed', suite: { id: 'fx-copy', version: '1.2.0', sha256: recorded } }) });
  const actual = loadSuite(root, 'fx-copy', { version: '1.2.0' }).sha256;
  const changed = lab(root, ['audit', 'checks', '--suite', 'fx-copy', '--suite-version', '1.2.0', '--json']);
  assert.notEqual(changed.code, 0);
  assert.match(changed.err, new RegExp(`Runs recorded fx-copy 1\\.2\\.0 with hash ${recorded}, but the copy has hash ${actual}`));
  assert.equal(changed.out, '');
  const current = lab(root, ['audit', 'checks', '--suite', 'fx-copy', '--suite-version', '2.0.0', '--json']);
  assert.equal(current.code, 0, current.err);
});

test('it audits the exact version named: a reference that fits the current tests fails the frozen ones', () => {
  const root = tempRoot();
  const adult = (tests) => codeCase('fx-frozen-adult', 'isAdult', tests);
  put(root, {
    'datasets/fx-frozen/suite.yaml': suiteYaml('fx-frozen', '2.0.0'),
    'datasets/fx-frozen/cases.jsonl': jsonl([adult([{ args: [18], returns: true }, { args: [5], returns: false }])]),
    'datasets/fx-frozen/checks/references/fx-frozen-adult.mjs': ADULT,
    'datasets/fx-frozen/versions/1.0.0/suite.yaml': suiteYaml('fx-frozen', '1.0.0'),
    'datasets/fx-frozen/versions/1.0.0/cases.jsonl': jsonl([adult([{ args: [18], returns: false }, { args: [5], returns: false }])]),
    'datasets/fx-frozen/versions/1.0.0/checks/references/fx-frozen-adult.mjs': ADULT,
  });
  const frozen = JSON.parse(lab(root, ['audit', 'checks', '--suite', 'fx-frozen', '--suite-version', '1.0.0', '--json']).out);
  assert.deepEqual([frozen.suite.version, frozen.suite.frozen, frozen.tasks[0].status, frozen.tasks[0].reason], ['1.0.0', true, 'excluded', 'reference does not match this version']);
  const current = JSON.parse(lab(root, ['audit', 'checks', '--suite', 'fx-frozen', '--suite-version', '2.0.0', '--json']).out);
  assert.deepEqual([current.suite.frozen, current.tasks[0].status, current.tasks[0].killed], [false, 'audited', 1]);
});

// ---- audit checks: an agent suite --------------------------------------------------------------

test('the agent audit mutates the reference solution and runs the hidden check on it', () => {
  const root = tempRoot();
  put(root, {
    'datasets/fx-agent/suite.yaml': suiteYaml('fx-agent', '1.0.0'),
    'datasets/fx-agent/cases.jsonl': jsonl([{ case_id: 'fx-agent-adult', input: { workspace: 'adult', task: 'fixture' }, expected: { check: 'adult' }, tags: ['tier-3-hard'], metadata: { tier: { level: 3 } } }]),
    'datasets/fx-agent/workspaces/adult/package.json': '{"name":"adult","private":true,"type":"module"}\n',
    'datasets/fx-agent/workspaces/adult/src/lib.mjs': 'export function isAdult(age) {\n  return age > 18;\n}\n',
    'datasets/fx-agent/checks/adult/probe.mjs': "export const probes = [\n  { name: 'at 18', run: async ({ load }) => (await load('src/lib.mjs')).isAdult(18) },\n  { name: 'child', run: async ({ load }) => (await load('src/lib.mjs')).isAdult(5) },\n];\n",
    'datasets/fx-agent/checks/adult/expected.json': '{"probes":{"at 18":true,"child":false},"files":{"package.json":{"same_as_starter":true}}}\n',
    'datasets/fx-agent/checks/references/adult/src/lib.mjs': ADULT,
  });
  const report = JSON.parse(lab(root, ['audit', 'checks', '--suite', 'fx-agent', '--suite-version', '1.0.0', '--json']).out);
  const item = report.tasks[0];
  assert.deepEqual([item.kind, item.status, item.tests, item.sites, item.mutants, item.killed, item.kill_rate], ['agent', 'audited', 3, 1, 1, 1, 1]);
  assert.deepEqual(item.results.map((mutant) => [mutant.file, mutant.line, mutant.operator, mutant.outcome]), [['src/lib.mjs', 2, '>= -> >', 'killed']]);
  assert.equal(item.reference.path, 'datasets/fx-agent/checks/references/adult');
});

test('a mutant in a file that the snapshot left out is excluded, not reported as a survivor; a reference that is not deterministic is excluded', () => {
  const root = tempRoot();
  const starter = { 'package.json': '{"name":"w","private":true,"type":"module"}\n' };
  const probes = Array.from({ length: 20 }, (_, i) => `  { name: 'p${i}', run: async ({ load }) => (await load('src/lib.mjs')).coin() },`).join('\n');
  const agentCase = (slug, check) => ({ case_id: `fx-agent2-${slug}`, input: { workspace: slug, task: 'fixture' }, expected: { check }, tags: ['tier-3-hard'], metadata: { tier: { level: 3 } } });
  put(root, {
    'datasets/fx-agent2/suite.yaml': suiteYaml('fx-agent2', '1.0.0'),
    'datasets/fx-agent2/cases.jsonl': jsonl([agentCase('big', 'adult'), agentCase('flaky', 'coin')]),
    'datasets/fx-agent2/workspaces/big/package.json': starter['package.json'],
    'datasets/fx-agent2/workspaces/big/src/lib.mjs': 'export function isAdult(age) {\n  return age > 18;\n}\n',
    'datasets/fx-agent2/checks/adult/probe.mjs': "export const probes = [\n  { name: 'at 18', run: async ({ load }) => (await load('src/lib.mjs')).isAdult(18) },\n  { name: 'child', run: async ({ load }) => (await load('src/lib.mjs')).isAdult(5) },\n];\n",
    'datasets/fx-agent2/checks/adult/expected.json': '{"probes":{"at 18":true,"child":false},"files":{"package.json":{"same_as_starter":true}}}\n',
    // 1.1 MiB: over the 1 MiB that a snapshot keeps for one file.
    'datasets/fx-agent2/checks/references/big/src/big.mjs': `// ${'x'.repeat(1.1 * 1024 * 1024)}\nexport const flag = true;\n`,
    'datasets/fx-agent2/checks/references/big/src/lib.mjs': ADULT,
    'datasets/fx-agent2/workspaces/flaky/package.json': starter['package.json'],
    'datasets/fx-agent2/workspaces/flaky/src/lib.mjs': 'export function coin() {\n  return false;\n}\n',
    'datasets/fx-agent2/checks/coin/probe.mjs': `export const probes = [\n${probes}\n];\n`,
    'datasets/fx-agent2/checks/coin/expected.json': JSON.stringify({ probes: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, true])), files: {} }),
    'datasets/fx-agent2/checks/references/flaky/src/lib.mjs': FLAKY,
  });
  const run = lab(root, ['audit', 'checks', '--suite', 'fx-agent2', '--suite-version', '1.0.0', '--json']);
  assert.equal(run.code, 0, run.err);
  const report = JSON.parse(run.out);
  const [big, flaky] = report.tasks;
  assert.deepEqual([big.status, big.sites, big.mutants, big.killed, big.survived, big.excluded_mutants], ['audited', 2, 1, 1, 0, 1]);
  assert.deepEqual(big.results.map((mutant) => [mutant.file, mutant.outcome, mutant.reason]), [
    ['src/big.mjs', 'excluded', 'src/big.mjs was not in the snapshot (file too large), so the check never saw the planted bug'],
    ['src/lib.mjs', 'killed', undefined],
  ]);
  assert.deepEqual(report.survivors, []);
  assert.deepEqual([flaky.status, flaky.reason], ['excluded', 'reference not deterministic']);
});

// ---- audit checks: the real ladder suites, references outside the suite ------------------------

test('the ladder suites read their references from tests/fixtures, and the frozen version is audited as frozen', () => {
  const run = lab(REPO, ['audit', 'checks', '--suite', 'ladder-code', '--suite-version', '1.0.0', '--cases', 'ladder-code-palindrome', '--json']);
  assert.equal(run.code, 0, run.err);
  const report = JSON.parse(run.out);
  const item = report.tasks[0];
  assert.deepEqual([report.suite.frozen, item.status, item.tests, item.sites, item.mutants, item.killed], [true, 'audited', 10, 1, 1, 1]);
  assert.match(item.reference.path, /^tests\/fixtures\/ladder-code-solutions\/core\/ladder-code-palindrome\.mjs$/);
  const agent = JSON.parse(lab(REPO, ['audit', 'checks', '--suite', 'ladder-agent', '--suite-version', '1.0.0', '--cases', 'ladder-agent-cart-discount', '--max', '3', '--json']).out);
  const own = agent.tasks[0];
  assert.deepEqual([own.status, own.reference.path, own.tests, own.sites, own.mutants, own.killed], ['audited', 'tests/fixtures/ladder-agent-solutions/core/cart-discount', 8, 1, 1, 1]);
});

// ---- bad use -----------------------------------------------------------------------------------

test('a bad suite id, an unknown version, a missing version and a bad audit block exit non-zero with a message and write nothing', () => {
  const root = tempRoot();
  fs.cpSync(codeRoot, root, { recursive: true });
  put(root, { 'datasets/fx-bad/suite.yaml': 'id: fx-bad\nversion: "1.0.0"\naudit:\n  references: ../outside\n', 'datasets/fx-bad/cases.jsonl': jsonl([CODE_CASES[0]]) });
  const state = listing(root);
  const expect = (args, pattern, write = true) => {
    const run = lab(root, ['audit', 'checks', ...(write ? ['--write'] : []), ...args]);
    assert.notEqual(run.code, 0, `${args.join(' ')} should fail`);
    assert.match(run.err, pattern);
    assert.equal(run.out, '');
  };
  expect(['--suite', 'no-such-suite', '--suite-version', '1.0.0'], /Error: No suite "no-such-suite" in datasets\//);
  expect(['--suite-version', '1.0.0'], /Name the suite/);
  expect(['--suite', 'fx-code', '--suite-version', '9.9.9'], /Suite fx-code has no version 9\.9\.9: the current version is 1\.0\.0/);
  expect(['--suite', 'fx-code'], /Name the exact version to audit.*current version of fx-code is 1\.0\.0/);
  expect(['--suite', 'fx-code', '--suite-version', '1.0.0', '--max', '0'], /--max must be a whole number of 1 or more/);
  expect(['--suite', 'fx-code', '--suite-version', '1.0.0', '--cases', 'fx-code-nope'], /has no case fx-code-nope/, false);
  expect(['--suite', 'fx-bad', '--suite-version', '1.0.0'], /audit\.references must be a folder under checks\//);
  assert.deepEqual(listing(root), state);
  assert.equal(fs.existsSync(path.join(root, 'reports')), false);
  const unknown = lab(root, ['audit', 'nothing']);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.err, /Unknown audit "nothing"/);
});

// ---- stability ---------------------------------------------------------------------------------

/**
 * A root with one suite and one run whose answers are the given code replies. The run is closed,
 * has a score file for each declared evaluator (every stored score is `stored`), and is in the
 * ledger, so it counts; `counted: false` leaves it out of the ledger.
 */
function stabilityRoot(caseId, tests, replies, { counted = true, evaluators = [['js-function', '2']], stored = 1 } = {}) {
  const root = tempRoot();
  put(root, {
    [`datasets/${caseId}/suite.yaml`]: `id: ${caseId}\nversion: "1.0.0"\ndescription: fixture\n`,
    [`datasets/${caseId}/cases.jsonl`]: jsonl([codeCase(`${caseId}-main`, 'answer', tests)]),
  });
  const suite = loadSuite(root, caseId);
  const runId = `20261108T000000Z__${caseId}__fx__aaaaaa`;
  const manifest = {
    run_id: runId,
    status: 'completed',
    suite: { id: caseId, version: '1.0.0', sha256: suite.sha256 },
    prompt: { id: 'js-function', version: '1', sha256: 'b'.repeat(64) },
    models: [{ model_key: 'fx-model', provider: 'fake', model: 'fx-model', params: {} }],
    harness: { name: 'fake', version: '1.0.0', settings: {} },
    evaluators: evaluators.map(([id, version]) => ({ id, version, dimension: 'quality' })),
  };
  const rows = replies.map((code, repeat) => ({ case_id: `${caseId}-main`, model_key: 'fx-model', repeat: repeat + 1, response: { text: `\`\`\`js\n${code}\n\`\`\`` } }));
  const files = { [`results/${runId}/run.json`]: JSON.stringify(manifest), [`results/${runId}/raw.jsonl`]: jsonl(rows) };
  for (const [id, version] of evaluators) {
    files[`results/${runId}/scores/${id}@${version}.jsonl`] = jsonl(rows.map((row) => ({ run_id: runId, case_id: row.case_id, model_key: row.model_key, repeat: row.repeat, evaluator_id: id, evaluator_version: version, dimension: 'quality', value: stored, passed: stored === 1 })));
  }
  if (!counted) ensureLedger(root);
  put(root, files);
  if (counted) ensureLedger(root);
  return { root, runId, runDir: path.join(root, 'results', runId) };
}

test('a stable answer scores the same three times, and stability writes nothing into the run folder', () => {
  const tests = Array.from({ length: 20 }, (_, i) => ({ args: [i], returns: i * 2 }));
  const { root, runId, runDir } = stabilityRoot('fx-stable', tests, ['export function answer(n) { return n * 2; }']);
  const state = listing(runDir);
  const run = lab(root, ['audit', 'stability', '--runs', runId, '--json']);
  assert.equal(run.code, 0, run.err);
  const report = JSON.parse(run.out);
  assert.deepEqual([report.answers, report.unstable, report.disagreements, report.differs_from_stored], [1, 0, [], 0]);
  assert.deepEqual(listing(runDir), state);
  const text = lab(root, ['audit', 'stability', '--runs', runId.slice(10, 40)]).out;
  assert.match(text, /Stability: 0 unstable of 1 answers scored/);
  assert.match(text, /By answer-evaluator pair: 0 unstable of 1 pairs/);
});

test('a named run that does not count (not in the ledger) is refused by name, with its reason', () => {
  const { root, runId } = stabilityRoot('fx-uncounted', [{ args: [1], returns: 1 }], ['export function answer(n) { return n; }'], { counted: false });
  const run = lab(root, ['audit', 'stability', '--runs', runId, '--json']);
  assert.notEqual(run.code, 0);
  assert.match(run.err, new RegExp(`Run ${runId} does not count: it is not in the ledger`));
  assert.match(run.err, /Stability reads only runs that count \(closed, ledger-matched, scored\)/);
  assert.equal(run.out, '');
});

test('stability reads only the score file of each evaluator the run declares, never a stray file in scores/', () => {
  const { root, runId, runDir } = stabilityRoot('fx-stray', [{ args: [2], returns: 4 }], ['export function answer(n) { return n * 2; }']);
  const stray = { run_id: runId, case_id: 'fx-stray-main', model_key: 'fx-model', repeat: 1, evaluator_id: 'js-function', evaluator_version: '2', dimension: 'quality', value: 0, passed: false };
  fs.writeFileSync(path.join(runDir, 'scores', 'zz-stray.jsonl'), jsonl([stray]));
  ensureLedger(root);
  const report = JSON.parse(lab(root, ['audit', 'stability', '--runs', runId, '--json']).out);
  assert.deepEqual([report.answers, report.unstable, report.differs_from_stored], [1, 0, 0]);
});

test('stability counts answers and answer-evaluator pairs apart, and the unstable rate uses the answers', () => {
  const tests = Array.from({ length: 20 }, (_, i) => ({ args: [i], returns: true }));
  const flaky = 'const q = Math.random();\nexport function answer() { return Math.random() < q; }';
  const { root, runId } = stabilityRoot('fx-pairs', tests, [flaky], { evaluators: [['js-function', '1'], ['js-function', '2']], stored: 0.5 });
  const report = JSON.parse(lab(root, ['audit', 'stability', '--runs', runId, '--json']).out);
  assert.deepEqual([report.answers, report.answer_evaluator_pairs, report.unstable, report.unstable_pairs], [1, 2, 1, 2]);
  assert.deepEqual(report.runs.map((run) => [run.answers, run.answer_evaluator_pairs, run.unstable, run.unstable_pairs]), [[1, 2, 1, 2]]);
  assert.equal(report.disagreements.length, 2);
  const text = lab(root, ['audit', 'stability', '--runs', runId]).out;
  assert.match(text, /Stability: 1 unstable of 1 answers scored/);
  assert.match(text, /By answer-evaluator pair: 2 unstable of 2 pairs/);
});

test('an answer with 20 tests that each depend on Math.random scores differently on a second look', () => {
  const tests = Array.from({ length: 20 }, (_, i) => ({ args: [i], returns: true }));
  // Each process draws its own chance q, so the score is spread over 0 to 20 and two answers agree three times only about once in 200,000 tries.
  const flaky = 'const q = Math.random();\nexport function answer() { return Math.random() < q; }';
  const { root, runId, runDir } = stabilityRoot('fx-flaky', tests, [flaky, flaky], { stored: 0.5 });
  const state = listing(runDir);
  const run = lab(root, ['audit', 'stability', '--runs', runId, '--json']);
  assert.equal(run.code, 0, run.err);
  const report = JSON.parse(run.out);
  assert.equal(report.answers, 2);
  assert.ok(report.unstable >= 1, 'two random answers scored three times each should disagree');
  const first = report.disagreements[0];
  assert.deepEqual([first.run_id, first.case_id, first.model_key, first.evaluator, first.scores.length], [runId, 'fx-flaky-main', 'fx-model', 'js-function@2', 3]);
  assert.ok(new Set(first.scores).size > 1);
  assert.deepEqual(listing(runDir), state);
  assert.match(lab(root, ['audit', 'stability', '--runs', runId]).out, /unstable answers:\n {2}20261108T000000Z__fx-flaky__fx__aaaaaa fx-flaky-main fx-model r\d js-function@2: /);
});

test('stability needs runs, and says so when a run is unknown', () => {
  const { root } = stabilityRoot('fx-none', [{ args: [1], returns: 1 }], ['export function answer(n) { return n; }']);
  const none = lab(root, ['audit', 'stability']);
  assert.notEqual(none.code, 0);
  assert.match(none.err, /Name the runs: --runs/);
  const unknown = lab(root, ['audit', 'stability', '--runs', 'no-such-run']);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.err, /No run matches "no-such-run"/);
});

// ---- specificity -------------------------------------------------------------------------------

test('five solutions written from the task text alone (drawn with a recorded seed) pass the hidden checks of the frozen version', async () => {
  const { getEvaluator } = await import('../lab/evaluators/index.mjs');
  const dir = path.join(HERE, 'fixtures', 'ladder-code-alternatives');
  const draw = JSON.parse(fs.readFileSync(path.join(dir, 'draw.json'), 'utf8'));
  assert.equal(draw.seed, 20261108);
  assert.equal(draw.drawn.length, 5);
  assert.ok(draw.drawn.every((id) => draw.pool.includes(id)));
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.mjs')).sort(), draw.drawn.map((id) => `${id}.mjs`).sort());
  const suite = loadSuite(REPO, 'ladder-code', { version: draw.suite_version });
  const evaluator = getEvaluator('js-function', '2');
  for (const id of draw.drawn) {
    const testCase = suite.cases.find((item) => item.case_id === id);
    const result = evaluator.score({ raw: { response: { text: fs.readFileSync(path.join(dir, `${id}.mjs`), 'utf8') } }, testCase });
    assert.deepEqual([id, result.value, result.passed], [id, 1, true]);
  }
});
