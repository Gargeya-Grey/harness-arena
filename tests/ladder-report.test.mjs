// node lab ladder: the report is shaped from the derived view (rows that count) and
// printed from that shape. These tests build a small data root with fake runs, vouch
// for them in the evidence ledger, and check literal values: solved counts, means,
// information classes, pair evidence, the negative-discrimination flag, the setup state
// of a run and the configuration id it gives.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptCommand } from '../lab/commands/adopt.mjs';
import { compareVersions, formatLadder, ladderCommand, ladderReport, pairLine } from '../lab/commands/ladder.mjs';
import { ensureLedger } from '../lab/lib/ledger.mjs';
import { ladderStatus, pairEvidence, signTestP, taskInformation } from '../lab/lib/ladder.mjs';
import { loadSuite } from '../lab/lib/repo.mjs';
import { buildState, configId, setupEvidenceOf, setupStateOf } from '../lab/lib/state.mjs';
import { answer } from '../dashboard/public/js/verdict.js';
import { S, setData, chooseContext, shownSetups, chartNames } from '../dashboard/public/js/model.js';
import { anyScored, renderCases } from '../dashboard/public/js/cases.js';
import { whoText } from '../dashboard/public/js/review.js';
import { renderSetups } from '../dashboard/public/js/setups.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUALITY = { id: 'workspace-tests', version: '1', dimension: 'quality' };

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const jsonl = (rows) => rows.map((row) => `${JSON.stringify(row)}\n`).join('');

const TIER_NAMES = ['easy', 'medium', 'hard', 'extra-hard', 'supreme'];

// A ladder case: slug, tier level, expert minutes.
const ladderCase = (suite, slug, level, minutes) => ({
  case_id: `${suite}-${slug}`,
  input: { task: slug, workspace: slug },
  expected: { check: slug },
  tags: [`tier-${level}-${TIER_NAMES[level - 1]}`],
  metadata: { tier: { level, name: TIER_NAMES[level - 1], human_minutes: minutes, basis: 'fixture for the report tests' } },
});

const CASES = [
  ladderCase('ladder-code', 'c1', 1, 1),
  ladderCase('ladder-code', 'c2', 2, 5),
  ladderCase('ladder-code', 'c3', 3, 20),
  ladderCase('ladder-code', 'c4', 4, 60),
  ladderCase('ladder-code', 'c5', 5, 200),
  ladderCase('ladder-code', 'c6', 2, 4),
];

// Scores per model and case, two repeats each. A is the strongest, C the weakest.
const SCORES = {
  'model-a': { c1: [1, 1], c2: [1, 1], c3: [0, 0], c4: [0, 0], c5: [1, 1], c6: [1, 1] },
  'model-b': { c1: [1, 1], c2: [1, 0], c3: [0, 0], c4: [1, 0], c5: [0, 0], c6: [1, 1] },
  'model-c': { c1: [1, 1], c2: [0, 0], c3: [0, 0], c4: [1, 1], c5: [0, 0], c6: [0, 1] },
};

function manifest(runId, modelKey, { status = 'completed', suite = 'ladder-code', suiteVersion = '1.0.0', suiteSha = 'a'.repeat(64), promptVersion = '1', evaluatorVersion = '1', harnessName = 'fake', harnessVersion = '1.0.0', harnessSettings = {} } = {}) {
  return {
    run_id: runId,
    created_at: '2026-11-01T10:00:00.000Z',
    finished_at: status === 'completed' ? '2026-11-01T10:30:00.000Z' : null,
    status,
    suite: { id: suite, version: suiteVersion, sha256: suiteSha },
    prompt: { id: 'js-function', version: promptVersion, sha256: 'b'.repeat(64) },
    experiment: { id: suite, suite, prompt: 'js-function', repeats: 2 },
    models: [{ model_key: modelKey, provider: 'fake', model: modelKey, params: {} }],
    repeats: 2,
    evaluators: [{ ...QUALITY, version: evaluatorVersion }],
    harness: { name: harnessName, version: harnessVersion, entrypoint: 'headless', access_method: 'subscription', platform: 'win32', session_id: null, settings: harnessSettings },
    ...(status === 'running' ? { runner: { pid: 1, heartbeat_at: '2026-11-01T10:00:00.000Z' } } : {}),
  };
}

// One run: rows = [{ slug, repeat, value }] or [{ slug, repeat, error: { type } }].
function writeRun(root, rand, modelKey, rows, options = {}) {
  const evaluatorVersion = options.evaluatorVersion ?? '1';
  const suite = options.suite ?? 'ladder-code';
  const runId = `20261101T100000Z__${suite}__${suite}__${rand}`;
  const dir = path.join(root, 'results', runId);
  write(path.join(dir, 'run.json'), `${JSON.stringify(manifest(runId, modelKey, options), null, 2)}\n`);
  const raw = rows.map(({ slug, repeat, error }) => ({
    run_id: runId,
    case_id: `${suite}-${slug}`,
    model_key: modelKey,
    repeat,
    started_at: '2026-11-01T10:00:00.000Z',
    latency_ms: 1000,
    tool_calls: 0,
    skills_used: [],
    request: { prompt_id: 'js-function', prompt_version: '1', messages: [], system_prompt: null, params: {} },
    response: error ? { text: null, finish_reason: null } : { text: 'x', finish_reason: 'end_turn' },
    usage: { input_tokens: 1, output_tokens: 1 },
    cost_usd: null,
    error: error ? { type: error.type, message: error.type } : null,
    metadata: {},
  }));
  const scores = rows
    .filter(({ error }) => !error)
    .map(({ slug, repeat, value }) => ({ run_id: runId, case_id: `${suite}-${slug}`, model_key: modelKey, repeat, evaluator_id: 'workspace-tests', evaluator_version: evaluatorVersion, dimension: 'quality', value, passed: value === 1, details: {} }));
  write(path.join(dir, 'raw.jsonl'), jsonl(raw));
  write(path.join(dir, 'scores', `workspace-tests@${evaluatorVersion}.jsonl`), jsonl(scores));
  return { runId, dir };
}

const rowsOf = (byCase) => Object.entries(byCase).flatMap(([slug, values]) => values.map((value, repeat) => ({ slug, repeat, value })));

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-ladder-report-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  fs.cpSync(path.join(REPO, 'configs', 'ladder.yaml'), path.join(root, 'configs', 'ladder.yaml'));
  write(path.join(root, 'datasets', 'ladder-code', 'suite.yaml'), 'id: ladder-code\nversion: "1.0.0"\n');
  write(path.join(root, 'datasets', 'ladder-code', 'cases.jsonl'), jsonl(CASES));
  return root;
}

/** The main fixture: three counted runs, plus two that must not count (still running; changed after it was vouched for). */
function mainRoot(t) {
  const root = makeRoot(t);
  const runs = {};
  for (const [index, key] of ['model-a', 'model-b', 'model-c'].entries()) runs[key] = writeRun(root, `a0000${index + 1}`, key, rowsOf(SCORES[key]));
  writeRun(root, 'b00001', 'model-running', rowsOf({ c1: [1, 1] }), { status: 'running' });
  const edited = writeRun(root, 'b00002', 'model-edited', rowsOf({ c1: [1, 1] }));
  ensureLedger(root);
  fs.appendFileSync(path.join(edited.dir, 'raw.jsonl'), '\n');
  return { root, runs };
}

const reportOf = (root, options = {}) => {
  const status = ladderStatus(root);
  return ladderReport({ state: buildState(root, { validate: false }), ladder: status.ladder, ladderCases: status.cases, ...options });
};

const byLabel = (report) => Object.fromEntries(report.configs.map((config) => [config.config_id.split('__')[0], config]));
const cellOf = (config, level) => {
  const { solved, counted, mean } = config.tiers[level];
  return [solved, counted, mean];
};

test('a tier cell holds solved / counted tasks and the mean score; the total line adds them up', (t) => {
  const { root } = mainRoot(t);
  const report = reportOf(root);
  const configs = byLabel(report);
  assert.deepEqual(Object.keys(configs).sort(), ['model-a', 'model-b', 'model-c'], 'a run still running and a run changed after it was vouched for count nowhere');
  assert.deepEqual(report.configs.map((config) => config.config_id.split('__')[0]), ['model-a', 'model-b', 'model-c'], 'strongest total first');
  assert.deepEqual(report.tiers.map((tier) => [tier.level, tier.tasks]), [[1, 1], [2, 2], [3, 1], [4, 1], [5, 1]]);

  // model-a: solves c1, both medium tasks and c5; fails c3 and c4.
  assert.deepEqual([1, 2, 3, 4, 5].map((level) => cellOf(configs['model-a'], level)), [[1, 1, 1], [2, 2, 1], [0, 1, 0], [0, 1, 0], [1, 1, 1]]);
  assert.deepEqual(configs['model-a'].total, { tasks: 6, counted: 6, solved: 4, mean: 0.667 });
  // model-b: c2 is 1 and 0 (mean 0.5), c4 is 1 and 0 (0.5).
  assert.deepEqual([1, 2, 3, 4, 5].map((level) => cellOf(configs['model-b'], level)), [[1, 1, 1], [1, 2, 0.75], [0, 1, 0], [0, 1, 0.5], [0, 1, 0]]);
  assert.deepEqual(configs['model-b'].total, { tasks: 6, counted: 6, solved: 2, mean: 0.5 });
  // model-c: c6 is 0 and 1 (0.5), c4 solved.
  assert.deepEqual([1, 2, 3, 4, 5].map((level) => cellOf(configs['model-c'], level)), [[1, 1, 1], [0, 2, 0.25], [0, 1, 0], [1, 1, 1], [0, 1, 0]]);
  assert.deepEqual(configs['model-c'].total, { tasks: 6, counted: 6, solved: 2, mean: 0.417 });
});

test('a case reports the information it gives; no band, no verdict and no panel mean are stored', (t) => {
  const { root } = mainRoot(t);
  const report = reportOf(root);
  const cases = Object.fromEntries(report.cases.map((entry) => [entry.case_id.replace('ladder-code-', ''), entry]));
  // c1: all three solve it. c3: none does. The rest split the three configurations.
  assert.deepEqual(Object.fromEntries(Object.entries(cases).map(([slug, entry]) => [slug, [entry.configs_n, entry.information]])), {
    c1: [3, 'all-solved'],
    c2: [3, 'disagree'],
    c3: [3, 'all-unsolved'],
    c4: [3, 'disagree'],
    c5: [3, 'disagree'],
    c6: [3, 'disagree'],
  });
  assert.deepEqual(report.information, { disagree: 4, 'one-config': 0, 'all-solved': 1, 'all-unsolved': 1, 'no-data': 0 });
  assert.deepEqual(cases.c2.per_config.map((entry) => [entry.config_id.split('__')[0], entry.mean, entry.n, entry.solved]), [['model-a', 1, 2, true], ['model-b', 0.5, 2, false], ['model-c', 0, 2, false]]);
  for (const entry of report.cases) for (const key of ['band', 'verdict', 'move_to', 'distance', 'mean']) assert.ok(!(key in entry), `${entry.case_id} has no ${key}`);
  assert.ok(report.tiers.every((tier) => !('band' in tier)));
});

test('taskInformation: a task with one configuration is one-config, never disagree; equal partial scores are all-unsolved', () => {
  const entry = (mean, extra = {}) => ({ config_id: 'x', mean, ...extra });
  assert.equal(taskInformation({ per_config: [] }), 'no-data');
  assert.equal(taskInformation({ per_config: [entry(1)] }), 'one-config');
  assert.equal(taskInformation({ per_config: [entry(0)] }), 'one-config');
  assert.equal(taskInformation({ per_config: [entry(0.5)] }), 'one-config');
  assert.equal(taskInformation({ per_config: [entry(1), entry(1)] }), 'all-solved');
  assert.equal(taskInformation({ per_config: [entry(0), entry(0)] }), 'all-unsolved');
  assert.equal(taskInformation({ per_config: [entry(0.5), entry(0.5)] }), 'all-unsolved', 'two identical partial scores do not separate anything');
  assert.equal(taskInformation({ per_config: [entry(1), entry(0.5)] }), 'disagree');
  assert.equal(taskInformation({ per_config: [entry(1), entry(0), entry(0.5)] }), 'disagree');
  assert.equal(taskInformation({ per_config: [entry(0.9999), entry(1)] }), 'disagree', 'a mean under 1 is not solved');
  assert.equal(taskInformation({ per_config: [{ solved: true }, { solved: false }] }), 'disagree', 'the solved flag decides when the entry has one');
});

test('one configuration alone gives one-config on every task and no pair', (t) => {
  const { root, runs } = mainRoot(t);
  const report = reportOf(root, { runs: [runs['model-b'].runId] });
  assert.deepEqual(report.cases.map((entry) => entry.information), Array(6).fill('one-config'));
  assert.deepEqual(report.information, { disagree: 0, 'one-config': 6, 'all-solved': 0, 'all-unsolved': 0, 'no-data': 0 });
  assert.deepEqual(report.pairs, []);
});

test('pairEvidence: shared tasks, the tasks only one side solved, the exact sign p and the mean difference', () => {
  // Hand-computed. Six shared tasks, 5 solved only by a and 1 only by b: p = 2 * (1 + 6) / 64 = 0.21875.
  const entry = (config_id, mean) => ({ config_id, mean });
  const cases = [
    { per_config: [entry('a', 1), entry('b', 0)] },
    { per_config: [entry('a', 1), entry('b', 0.5)] },
    { per_config: [entry('a', 1), entry('b', 0)] },
    { per_config: [entry('a', 1), entry('b', 0)] },
    { per_config: [entry('a', 1), entry('b', 0)] },
    { per_config: [entry('a', 0), entry('b', 1)] },
    { per_config: [entry('a', 1), entry('b', 1)] },
    { per_config: [entry('a', 0), entry('b', 0)] },
    { per_config: [entry('a', 0.5), entry('b', 0.5)] },
    { per_config: [entry('a', 1)] },
    { per_config: [entry('b', 1)] },
    { per_config: [] },
  ];
  // Differences a - b over the nine shared tasks: 1, 0.5, 1, 1, 1, -1, 0, 0, 0 = 3.5; 3.5 / 9 = 0.389.
  assert.deepEqual(pairEvidence(cases, 'a', 'b'), { shared: 9, a_only: 5, b_only: 1, sign_p: 0.21875, mean_diff: 0.389 });
  assert.deepEqual(pairEvidence(cases, 'b', 'a'), { shared: 9, a_only: 1, b_only: 5, sign_p: 0.21875, mean_diff: -0.389 });
  assert.deepEqual(pairEvidence(cases, 'a', 'missing'), { shared: 0, a_only: 0, b_only: 0, sign_p: 1, mean_diff: null });
  assert.equal(signTestP(0, 0), 1);
  assert.equal(signTestP(6, 0), 0.03125, '2 / 64');
  assert.equal(signTestP(3, 3), 1, 'an even split is capped at 1');
  assert.equal(signTestP(2, 0), 0.5);
  assert.equal(signTestP(3, 1), 0.625, '2 * (1 + 4) / 16');
});

test('pairEvidence on the report: the pairs of the main fixture, computed by hand', (t) => {
  const { root } = mainRoot(t);
  const report = reportOf(root);
  const id = (key) => report.configs.find((config) => config.config_id.startsWith(`${key}__`)).config_id;
  // model-a solves c1 c2 c5 c6; model-b solves c1 c6 (c2 and c4 are 0.5); model-c solves c1 c4.
  assert.deepEqual(pairEvidence(report.cases, id('model-a'), id('model-b')), { shared: 6, a_only: 2, b_only: 0, sign_p: 0.5, mean_diff: 0.167 });
  assert.deepEqual(pairEvidence(report.cases, id('model-a'), id('model-c')), { shared: 6, a_only: 3, b_only: 1, sign_p: 0.625, mean_diff: 0.25 });
  assert.deepEqual(report.pairs.map((pair) => [pair.a.split('__')[0], pair.b.split('__')[0], pair.shared, pair.a_only, pair.b_only, pair.sign_p]), [
    ['model-a', 'model-b', 6, 2, 0, 0.5],
    ['model-a', 'model-c', 6, 3, 1, 0.625],
    ['model-b', 'model-c', 6, 1, 1, 1],
  ]);
});

test('negative discrimination: a weaker configuration solves a task that a stronger one fails on every repeat', (t) => {
  const { root } = mainRoot(t);
  const flagged = reportOf(root).cases.filter((entry) => entry.flags.length);
  assert.deepEqual(flagged.map((entry) => entry.case_id), ['ladder-code-c4']);
  assert.deepEqual(flagged[0].flags.map((flag) => [flag.flag, flag.solved_by.split('__')[0], flag.failed_by.split('__')[0]]), [['negative discrimination', 'model-c', 'model-a']]);
});

test('the tier table keeps no target band, and the source keeps no verdictFor', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(REPO, 'configs', 'ladder.yaml'), 'utf8'), /^\s*band:/m);
  for (const file of ['lab/commands/ladder.mjs', 'lab/lib/ladder.mjs']) assert.doesNotMatch(fs.readFileSync(path.join(REPO, file), 'utf8'), /verdictFor/, file);
});

test('a timeout counts as 0 for the configuration; a rate limit does not count at all', (t) => {
  const root = makeRoot(t);
  writeRun(root, 'c00001', 'model-d', [
    { slug: 'c1', repeat: 0, error: { type: 'timeout' } },
    { slug: 'c1', repeat: 1, value: 1 },
    { slug: 'c2', repeat: 0, error: { type: 'rate_limit' } },
    { slug: 'c2', repeat: 1, value: 1 },
  ]);
  ensureLedger(root);
  const [config] = reportOf(root).configs;
  assert.deepEqual(cellOf(config, 1), [0, 1, 0.5], 'c1: 0 and 1, not solved');
  assert.deepEqual(cellOf(config, 2), [1, 1, 1], 'c2: the lost call leaves one repeat, which is 1');
  assert.deepEqual(config.tiers[2].tasks, 2);
  assert.deepEqual(config.total, { tasks: 6, counted: 2, solved: 1, mean: 0.75 });
});

test('filters: one ladder suite (by id or kind) and chosen runs', (t) => {
  const { root, runs } = mainRoot(t);
  assert.equal(reportOf(root, { suite: 'ladder-code' }).configs.length, 3);
  assert.equal(reportOf(root, { suite: 'code' }).cases.length, 6);
  const none = reportOf(root, { suite: 'ladder-answer' });
  assert.deepEqual([none.configs.length, none.cases.length, none.tiers.map((tier) => tier.tasks)], [0, 0, [0, 0, 0, 0, 0]]);
  const one = reportOf(root, { runs: [runs['model-b'].runId] });
  assert.deepEqual(one.configs.map((config) => config.config_id.split('__')[0]), ['model-b']);
  assert.equal(one.cases.find((entry) => entry.case_id === 'ladder-code-c2').configs_n, 1);
});

test('ladderCommand prints ladder problems first, then the table; --calibrate adds the case table', (t) => {
  const { root } = mainRoot(t);
  const lines = [];
  ladderCommand(root, { calibrate: true, log: (line) => lines.push(line) });
  const text = lines.join('\n');
  assert.match(lines[0], /^Ladder problems \(15\):$/);
  assert.match(text, /easy: 1 code task\(s\), the ladder asks for 2/);
  assert.ok(text.indexOf('Ladder problems') < text.indexOf('Solved / tasks counted'));
  const a = lines.find((line) => line.startsWith('model-a__fake-1.0.0__default'));
  assert.match(a, /1\/1\s+1\.00\s+2\/2\s+1\.00\s+0\/1\s+0\.00\s+0\/1\s+0\.00\s+1\/1\s+1\.00\s+4\/6\s+0\.67/);
  assert.match(lines.find((line) => line.startsWith('ladder-code-c2')), /2 medium\s+3\s+disagree$/);
  assert.match(lines.find((line) => line.startsWith('ladder-code-c3')), /3 hard\s+3\s+all-unsolved$/);
  assert.match(lines.find((line) => line.startsWith('ladder-code-c4')), /disagree\s+negative discrimination$/);
  assert.match(text, /Information: 4 disagree, 1 all-solved, 1 all-unsolved\./);
  assert.doesNotMatch(text, /band|verdict/i);
  assert.match(text, /ladder-code-c4: solved by model-c__fake-1\.0\.0__default, failed on every repeat by model-a__fake-1\.0\.0__default/);
  assert.ok(lines.includes('  Model A · fake vs Model B · fake: 6 shared, 2 and 0, p 0.50'), lines.join('\n'));
  assert.ok(lines.includes('  Model A · fake vs Model C · fake: 6 shared, 3 and 1, p 0.63'), 'p 0.625 prints with two decimals');
});

test('--json prints the same data, with the problems and the filters', (t) => {
  const { root } = mainRoot(t);
  const lines = [];
  const report = ladderCommand(root, { json: true, suite: 'code', log: (line) => lines.push(line) });
  const parsed = JSON.parse(lines.join('\n'));
  assert.deepEqual(parsed.configs, JSON.parse(JSON.stringify(report.configs)));
  assert.deepEqual(Object.keys(parsed).sort(), ['cases', 'configs', 'filters', 'information', 'pairs', 'problems', 'tiers', 'versions', 'warnings']);
  assert.ok(!JSON.stringify(parsed).includes('"band"'), 'no band field anywhere');
  assert.equal(parsed.cases.length, 6);
  assert.deepEqual(parsed.filters, { suite: 'ladder-code', runs: null, suite_versions: null });
  assert.deepEqual(parsed.versions, [{ suite: 'ladder-code', version: '1.0.0', prompt: 'js-function@1', runs: 3, left_out_runs: 0, left_out_versions: [], cases_from: 'disk' }]);
  assert.deepEqual(parsed.warnings, []);
  assert.ok(parsed.problems.length > 0);
  assert.throws(() => ladderCommand(root, { suite: 'nope', log: () => {} }), /--suite must be one of ladder-answer, ladder-code, ladder-agent/);
  assert.throws(() => ladderCommand(root, { runs: ['no-such-run'], log: () => {} }), /no run matches/);
});

test('with no counted run the table is empty and nothing breaks; a root without a ladder says so', (t) => {
  const root = makeRoot(t);
  const lines = [];
  ladderCommand(root, { calibrate: true, log: (line) => lines.push(line) });
  const text = lines.join('\n');
  assert.match(text, /configuration\s+1 easy \(1\)\s+2 medium \(2\)/);
  assert.match(text, /No counted ladder runs yet/);
  assert.match(text, /ladder-code-c1\s+1 easy\s+0\s+no-data/);
  assert.match(text, /No two configurations share a counted task\./);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-ladder-bare-'));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true, maxRetries: 5 }));
  assert.throws(() => ladderCommand(bare, { log: () => {} }), /No usable difficulty ladder/);
});

// Two suite versions of one task, one configuration: the old run scored 0, the reworked task scores 1.
function versionedRoot(t) {
  const root = makeRoot(t);
  // The 1.0.0 run records the hash of the suite as it is on disk now (1.0.0).
  writeRun(root, 'd00001', 'model-a', rowsOf({ c1: [0, 0], c2: [1, 1] }), { suiteVersion: '1.0.0', suiteSha: loadSuite(root, 'ladder-code').sha256 });
  writeRun(root, 'd00002', 'model-a', rowsOf({ c1: [1, 1] }), { suiteVersion: '1.1.0' });
  ensureLedger(root);
  return root;
}

test('suite versions: the newest version with counted runs is used, and one line says what was left out', (t) => {
  const root = versionedRoot(t);
  const lines = [];
  const report = ladderCommand(root, { calibrate: true, log: (line) => lines.push(line) });
  assert.ok(lines.includes('Suite versions used: ladder-code 1.1.0 (1 run). Left out: 1 counted run of other versions (ladder-code 1.0.0).'));
  const c1 = report.cases.find((entry) => entry.case_id === 'ladder-code-c1');
  assert.deepEqual([c1.per_config[0].mean, c1.configs_n, c1.information], [1, 1, 'one-config'], 'the old score 0 is not averaged in');
  assert.deepEqual(cellOf(report.configs[0], 2), [0, 0, null], 'c2 was only in the old version');
  assert.deepEqual(report.versions, [{ suite: 'ladder-code', version: '1.1.0', prompt: 'js-function@1', runs: 1, left_out_runs: 1, left_out_versions: ['1.0.0'] }].map((item) => ({ ...item, cases_from: 'disk' })));
});

test('an older suite version with a frozen copy is reported with its own cases and tiers, and no warning', (t) => {
  const root = versionedRoot(t);
  // The disk is at 1.0.0 in this fixture; make it 1.1.0 without c2, and keep 1.0.0 as a frozen copy.
  const dir = path.join(root, 'datasets', 'ladder-code');
  write(path.join(dir, 'versions', '1.0.0', 'suite.yaml'), fs.readFileSync(path.join(dir, 'suite.yaml'), 'utf8'));
  write(path.join(dir, 'versions', '1.0.0', 'cases.jsonl'), fs.readFileSync(path.join(dir, 'cases.jsonl'), 'utf8'));
  write(path.join(dir, 'suite.yaml'), 'id: ladder-code\nversion: "1.1.0"\n');
  write(path.join(dir, 'cases.jsonl'), jsonl(CASES.filter((item) => item.case_id !== 'ladder-code-c2')));
  const lines = [];
  const old = ladderCommand(root, { calibrate: true, suiteVersions: ['ladder-code@1.0.0'], log: (line) => lines.push(line) });
  assert.deepEqual(old.cases.map((entry) => entry.case_id).sort(), CASES.map((item) => item.case_id).sort(), 'every case of 1.0.0, also the one 1.1.0 dropped');
  assert.equal(old.cases.find((entry) => entry.case_id === 'ladder-code-c2').per_config[0].mean, 1);
  assert.equal(old.versions[0].cases_from, 'frozen copy');
  assert.deepEqual(old.warnings, []);
  assert.ok(lines.some((line) => line.startsWith('Suite versions used: ladder-code 1.0.0 (1 run; cases and tiers of its frozen copy).')), lines.join('\n'));
  // A copy that is not the content the run used is not read: c5 moved to tier 1 in it.
  const copyCases = path.join(dir, 'versions', '1.0.0', 'cases.jsonl');
  const good = fs.readFileSync(copyCases, 'utf8');
  write(copyCases, jsonl(CASES.map((item) => (item.case_id === 'ladder-code-c5' ? ladderCase('ladder-code', 'c5', 1, 1) : item))));
  const tampered = ladderCommand(root, { calibrate: true, suiteVersions: ['ladder-code@1.0.0'], json: true, log: () => {} });
  assert.equal(tampered.versions[0].cases_from, 'disk');
  assert.equal(tampered.cases.find((entry) => entry.case_id === 'ladder-code-c5').tier, 5);
  assert.equal(tampered.warnings.length, 1);
  assert.match(tampered.warnings[0].message, /the frozen copy of 1\.0\.0 is not the content its runs used/);
  write(copyCases, good);
  // Two runs of one version with different hashes share a context: the runs chosen decide.
  const other = writeRun(root, 'd00003', 'model-b', rowsOf({ c1: [1, 1], c2: [1, 1] }), { suiteVersion: '1.0.0', suiteSha: 'c'.repeat(64) });
  ensureLedger(root);
  adoptCommand(root, [other.runId], { log: () => {} });
  const onlyGood = ladderCommand(root, { calibrate: true, suiteVersions: ['ladder-code@1.0.0'], runs: ['d00001'], json: true, log: () => {} });
  assert.equal(onlyGood.versions[0].cases_from, 'frozen copy');
  const onlyBad = ladderCommand(root, { calibrate: true, suiteVersions: ['ladder-code@1.0.0'], runs: ['d00003'], json: true, log: () => {} });
  assert.equal(onlyBad.versions[0].cases_from, 'disk');
  // Without the copy, the disk's case set stands and the warning says so.
  fs.rmSync(path.join(dir, 'versions'), { recursive: true, force: true });
  const bare = ladderCommand(root, { calibrate: true, suiteVersions: ['ladder-code@1.0.0'], json: true, log: () => {} });
  assert.ok(!bare.cases.some((entry) => entry.case_id === 'ladder-code-c2'));
  assert.equal(bare.versions[0].cases_from, 'disk');
  assert.equal(bare.warnings.length, 1);
});

test('--suite-version picks another version; a bad value or two versions of one suite is refused', (t) => {
  const root = versionedRoot(t);
  const lines = [];
  const report = ladderCommand(root, { calibrate: true, suiteVersions: ['ladder-code@1.0.0'], log: (line) => lines.push(line) });
  assert.ok(lines.includes('Suite versions used: ladder-code 1.0.0 (1 run). Left out: 1 counted run of other versions (ladder-code 1.1.0).'));
  const byCase = Object.fromEntries(report.cases.map((entry) => [entry.case_id, entry.per_config[0]?.mean ?? null]));
  assert.deepEqual([byCase['ladder-code-c1'], byCase['ladder-code-c2']], [0, 1]);
  const short = ladderCommand(root, { suiteVersions: ['code@1.0.0'], json: true, log: () => {} });
  assert.equal(short.versions[0].version, '1.0.0', 'the short suite name works');
  for (const bad of ['ladder-code', 'ladder-code@', 'nope@1.0.0', '@1.0.0']) {
    assert.throws(() => ladderCommand(root, { suiteVersions: [bad], log: () => {} }), /--suite-version must be <suite>@<version>/, bad);
  }
  assert.throws(() => ladderCommand(root, { suiteVersions: ['ladder-code@1.0.0', 'ladder-code@1.1.0'], log: () => {} }), /names two versions of ladder-code: 1\.0\.0 and 1\.1\.0/);
  const none = ladderCommand(root, { suiteVersions: ['ladder-code@9.9.9'], json: true, log: () => {} });
  assert.deepEqual([none.configs.length, none.versions[0].runs, none.versions[0].left_out_runs], [0, 0, 2], 'a version with no counted run gives an empty table');
});

test('suite versions: dotted numbers compare as numbers; a suite version that mixes prompt versions is refused', (t) => {
  assert.deepEqual(['1.10.0', '1.9.0', '1.2.0', '2.0.0'].sort(compareVersions), ['1.2.0', '1.9.0', '1.10.0', '2.0.0']);
  const root = makeRoot(t);
  writeRun(root, 'e00001', 'model-a', rowsOf({ c1: [1, 1] }), { promptVersion: '1' });
  const second = writeRun(root, 'e00002', 'model-b', rowsOf({ c1: [1, 1] }), { promptVersion: '2' });
  ensureLedger(root);
  assert.throws(() => reportOf(root), /ladder-code@1\.0\.0 has counted runs with different prompt versions \(js-function@1, js-function@2\).*--runs/);
  assert.equal(reportOf(root, { runs: [second.runId] }).configs.length, 1, '--runs keeps one prompt version');
});

// Rule 4 fixture: model-w fails c2 and solves c3. Each other configuration is [model key, scores by case].
function discriminationRoot(t, others) {
  const root = makeRoot(t);
  writeRun(root, 'f00001', 'model-w', rowsOf({ c2: [0, 0], c3: [1, 1] }));
  others.forEach(([key, byCase], index) => writeRun(root, `f0001${index}`, key, rowsOf(byCase)));
  ensureLedger(root);
  return root;
}
const flagsOf = (report, slug = 'c3') => report.cases.find((entry) => entry.case_id === `ladder-code-${slug}`).flags.map((flag) => [flag.solved_by.split('__')[0], flag.failed_by.split('__')[0], flag.shared_tasks, flag.solved_by_mean, flag.failed_by_mean]);

test('negative discrimination compares configurations on the tasks both ran, not on their own totals', (t) => {
  // model-s ran easy extra tasks, so its own total (0.6) is above model-w's (0.5), but on the shared task c2 both score 0.
  // model-t scores 1 on c2: on the shared task it is the stronger one, and it fails c3.
  const root = discriminationRoot(t, [
    ['model-s', { c2: [0, 0], c3: [0, 0], c4: [1, 1], c5: [1, 1], c6: [1, 1] }],
    ['model-t', { c2: [1, 1], c3: [0, 0], c4: [1, 1] }],
  ]);
  assert.deepEqual(flagsOf(reportOf(root)), [['model-w', 'model-t', 1, 0, 1]]);
  const lines = [];
  ladderCommand(root, { calibrate: true, log: (line) => lines.push(line) });
  assert.match(lines.join('\n'), /ladder-code-c3: solved by model-w__fake-1\.0\.0__default, failed on every repeat by model-t__fake-1\.0\.0__default, which has the higher mean on the 1 other shared task\(s\) \(1\.00 against 0\.00\)/);
});

test('negative discrimination: no other shared task, no flag; failed means under 0.5 on every repeat, so 0.95 is not failed', (t) => {
  const root = discriminationRoot(t, [
    ['model-x', { c3: [0, 0] }],
    ['model-p', { c2: [1, 1], c3: [0.95, 0.95] }],
    ['model-q', { c2: [1, 1], c3: [0.4, 0.4] }],
    ['model-r', { c2: [1, 1], c3: [0.4, 0.9] }],
  ]);
  const report = reportOf(root);
  assert.deepEqual(flagsOf(report), [['model-w', 'model-q', 1, 0, 1]], '0.95 and 0.95 is a near miss, and 0.4 with 0.9 is not a failure on every repeat');
  const perConfig = Object.fromEntries(report.cases.find((entry) => entry.case_id === 'ladder-code-c3').per_config.map((entry) => [entry.config_id.split('__')[0], [entry.solved, entry.failed]]));
  assert.deepEqual(perConfig, { 'model-w': [true, false], 'model-x': [false, true], 'model-p': [false, false], 'model-q': [false, true], 'model-r': [false, false] });
});

test('suite versions: a suite version that mixes quality evaluator versions is refused, naming both; --runs keeps one', (t) => {
  const root = makeRoot(t);
  writeRun(root, 'g00001', 'model-a', rowsOf({ c1: [1, 1] }), { evaluatorVersion: '1' });
  const second = writeRun(root, 'g00002', 'model-b', rowsOf({ c1: [1, 1] }), { evaluatorVersion: '2' });
  ensureLedger(root);
  assert.throws(() => reportOf(root), /ladder-code@1\.0\.0 has counted runs scored with different quality evaluator versions \(workspace-tests@1, workspace-tests@2\).*--runs/);
  assert.throws(() => ladderCommand(root, { log: () => {} }), /workspace-tests@1, workspace-tests@2/);
  assert.equal(reportOf(root, { runs: [second.runId] }).configs.length, 1, '--runs keeps one evaluator version');
  // Another suite version with the newer evaluator is a different suite version: no mix, no refusal.
  const other = makeRoot(t);
  writeRun(other, 'g00003', 'model-a', rowsOf({ c1: [1, 1] }), { suiteVersion: '1.0.0', evaluatorVersion: '1' });
  writeRun(other, 'g00004', 'model-a', rowsOf({ c1: [1, 1] }), { suiteVersion: '1.1.0', evaluatorVersion: '2' });
  ensureLedger(other);
  assert.equal(reportOf(other).versions[0].version, '1.1.0');
});

test('a scored suite version that is not the version on disk: one warning line per suite, in the text and in the JSON; the disk tiers are used', (t) => {
  const root = versionedRoot(t);
  write(path.join(root, 'datasets', 'ladder-code', 'suite.yaml'), 'id: ladder-code\nversion: "1.2.0"\n');
  const lines = [];
  const report = ladderCommand(root, { calibrate: true, log: (line) => lines.push(line) });
  const warnings = lines.filter((line) => line.startsWith('Warning:'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Warning: ladder-code: scores are from suite version 1\.1\.0, but the suite on disk is 1\.2\.0\. Tiers, tier sizes and the case set are those of 1\.2\.0; the tiers of 1\.1\.0 are not stored in a run/);
  assert.deepEqual(report.warnings.map(({ suite, scored_version, disk_version, tier_source }) => [suite, scored_version, disk_version, tier_source]), [['ladder-code', '1.1.0', '1.2.0', 'disk']]);
  // --suite-version picks the older version: the warning names that one.
  const old = ladderCommand(root, { suiteVersions: ['ladder-code@1.0.0'], json: true, log: () => {} });
  assert.deepEqual(old.warnings.map((entry) => [entry.scored_version, entry.disk_version]), [['1.0.0', '1.2.0']]);
  const json = [];
  ladderCommand(root, { json: true, log: (line) => json.push(line) });
  assert.equal(JSON.parse(json.join('\n')).warnings.length, 1);
  // Scores of the version on disk: no warning. A chosen version with no counted run: nothing was scored, no warning.
  const same = versionedRoot(t);
  write(path.join(same, 'datasets', 'ladder-code', 'suite.yaml'), 'id: ladder-code\nversion: "1.1.0"\n');
  assert.deepEqual(ladderCommand(same, { json: true, log: () => {} }).warnings, []);
  assert.deepEqual(ladderCommand(root, { suiteVersions: ['ladder-code@9.9.9'], json: true, log: () => {} }).warnings, []);
  // A suite that --suite leaves out gets no warning.
  assert.deepEqual(ladderCommand(root, { suite: 'ladder-answer', json: true, log: () => {} }).warnings, []);
});

test('--suite-version for a suite that --suite leaves out is refused, not ignored', (t) => {
  const root = versionedRoot(t);
  assert.throws(() => ladderCommand(root, { suite: 'code', suiteVersions: ['ladder-agent@1.0.0'], log: () => {} }), /--suite-version ladder-agent@1\.0\.0 is for a suite that --suite code leaves out/);
  const same = ladderCommand(root, { suite: 'ladder-code', suiteVersions: ['code@1.0.0'], json: true, log: () => {} });
  assert.equal(same.versions[0].version, '1.0.0', 'the same suite, by alias, is fine');
  const lines = [];
  ladderCommand(root, { suite: 'ladder-code', suiteVersions: ['ladder-code@1.0.0'], json: true, log: (line) => lines.push(line) });
  assert.deepEqual(JSON.parse(lines.join('\n')).filters.suite_versions, ['ladder-code@1.0.0']);
});

// ---- Setup state: what a run kept out of the harness's own setup, and the configuration id it gives ----

const CLAUDE_BASE = ['--setting-sources', 'project,local', '--strict-mcp-config', '--disable-slash-commands'];
const MDS = 'CLAUDE_CODE_DISABLE_CLAUDE_MDS=1';
const MEMORY = 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=1';
const asked = (flags) => ({ user_config: 'isolated', user_config_requested: 'isolated', user_config_flags: flags });
const evidence = (name, settings) => setupEvidenceOf({ harness: { name, settings } });

test('setup state: a flag string parses, a missing flag leaks, a record that proves nothing is unknown', () => {
  assert.deepEqual(evidence('claude-code', {}), { state: 'loaded', missing: [] });
  assert.deepEqual(evidence('claude-code', { user_config: 'loaded', user_config_requested: 'isolated', user_config_flags: CLAUDE_BASE }), { state: 'loaded', missing: [] }, 'the harness could not skip the setup, so it loaded');
  // Kept out: every flag of the table, in any order, as separate items, as one string, or as flag=value.
  assert.deepEqual(evidence('claude-code', asked([...CLAUDE_BASE, MDS, MEMORY])), { state: 'kept out', missing: [] });
  assert.deepEqual(evidence('claude-code', asked([MEMORY, MDS, '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', 'project,local'])).state, 'kept out');
  assert.equal(evidence('claude-code', asked(['--setting-sources=project,local', '--strict-mcp-config', '--disable-slash-commands', `${MDS} ${MEMORY}`])).state, 'kept out');
  // Leaked: flags are recorded, and one the table needs is not there.
  assert.deepEqual(evidence('claude-code', asked([...CLAUDE_BASE, MDS])), { state: 'leaked', missing: [MEMORY] });
  assert.deepEqual(evidence('claude-code', asked(CLAUDE_BASE)), { state: 'leaked', missing: [MDS, MEMORY] }, 'a pilot 1 Claude Code run');
  assert.deepEqual(evidence('claude-code', asked([...CLAUDE_BASE, 'CLAUDE_CODE_DISABLE_CLAUDE_MDS=0', MEMORY])), { state: 'leaked', missing: [MDS] }, 'the value counts');
  assert.deepEqual(evidence('claude-code', asked(['--setting-sources', 'user,project', '--strict-mcp-config', '--disable-slash-commands', MDS, MEMORY])), { state: 'leaked', missing: ['--setting-sources'] }, 'user settings are a source');
  // Unknown: nothing recorded, or a harness that has no table.
  assert.deepEqual(evidence('claude-code', asked([])), { state: 'unknown', missing: [] });
  assert.deepEqual(evidence('claude-code', { user_config: 'isolated' }), { state: 'unknown', missing: [] });
  assert.deepEqual(evidence('declared-cli', asked(['--no-user'])), { state: 'unknown', missing: [] });
  assert.deepEqual(evidence(undefined, asked(['--no-user'])), { state: 'unknown', missing: [] });
  // Partly kept out: every flag is there and the harness still loads part of the setup (Command Code).
  assert.deepEqual(evidence('command-code', asked(['--no-skills'])), { state: 'partly kept out', missing: [] });
  assert.deepEqual(evidence('command-code', asked(['--yolo'])), { state: 'leaked', missing: ['--no-skills'] });
  assert.deepEqual(evidence('command-code', asked([])), { state: 'unknown', missing: [] });
  // The other harnesses name a temp home; any value counts, an empty one does not.
  assert.equal(evidence('codex', asked(['HOME=<temp home>', 'USERPROFILE=<temp home>', 'CODEX_HOME=<temp home>/.codex'])).state, 'kept out');
  assert.deepEqual(evidence('codex', asked(['HOME=<temp home>', 'USERPROFILE=<temp home>'])), { state: 'leaked', missing: ['CODEX_HOME='] });
  assert.deepEqual(evidence('codex', asked(['CODEX_HOME='])), { state: 'leaked', missing: ['CODEX_HOME='] });
  assert.equal(evidence('gemini-cli', asked(['HOME=<temp home>', 'GEMINI_CLI_HOME=<temp home>', 'GOOGLE_GENAI_USE_GCA=true'])).state, 'kept out');
  assert.deepEqual(evidence('gemini-cli', asked(['GEMINI_CLI_HOME=<temp home>'])), { state: 'leaked', missing: ['GOOGLE_GENAI_USE_GCA=true'] });
  const xdg = ['XDG_CONFIG_HOME=<temp home>/.config', 'XDG_DATA_HOME=<temp home>/.local/share', 'XDG_STATE_HOME=<temp home>/.local/state', 'XDG_CACHE_HOME=<temp home>/.cache'];
  assert.equal(evidence('opencode', asked(xdg)).state, 'kept out');
  assert.deepEqual(evidence('opencode', asked(xdg.slice(0, 3))), { state: 'leaked', missing: ['XDG_CACHE_HOME='] });
  assert.equal(setupStateOf({ harness: { name: 'command-code', settings: asked(['--no-skills']) } }), 'partly kept out');
  assert.equal(setupStateOf({}), 'loaded');
});

test('the configuration id follows the setup state, and the legacy id is the id from before the split', () => {
  const harness = { name: 'claude-code', version: '2.1.306' };
  const base = 'm__claude-code-2.1.306__default';
  assert.equal(configId('m', harness, null, 'loaded'), base);
  assert.equal(configId('m', harness, null, 'kept out'), `${base}__isolated`);
  assert.equal(configId('m', harness, null, 'leaked'), `${base}__isolated-leaked`);
  assert.equal(configId('m', harness, null, 'partly kept out'), `${base}__isolated-partial`);
  assert.equal(configId('m', harness, null, 'unknown'), `${base}__isolated-unknown`);
  assert.equal(configId('m', harness, 'low', 'leaked', 'off'), 'm__claude-code-2.1.306__low__isolated-leaked__no-tools');
  assert.equal(configId('m', harness, null, 'isolated'), `${base}__isolated`, 'the old pair still gives the old id');
});

// One model, one harness, two Claude Code runs: one leaked (pilot 1 flags), one with both flags.
function claudeRoot(t, { extra = () => {} } = {}) {
  const root = makeRoot(t);
  const leaked = writeRun(root, 'h00001', 'model-a', rowsOf({ c1: [1, 1], c2: [0, 0], c3: [0, 0] }), { harnessName: 'claude-code', harnessSettings: asked(CLAUDE_BASE) });
  const clean = writeRun(root, 'h00002', 'model-a', rowsOf({ c1: [1, 1], c2: [1, 1], c3: [0, 0] }), { harnessName: 'claude-code', harnessSettings: asked([...CLAUDE_BASE, MDS, MEMORY]) });
  const loaded = writeRun(root, 'h00003', 'model-b', rowsOf({ c1: [1, 1], c2: [0, 0], c3: [0, 0] }), { harnessName: 'claude-code' });
  extra({ root, leaked, clean, loaded });
  ensureLedger(root);
  return { root, leaked, clean, loaded };
}
const LEGACY = 'model-a__claude-code-1.0.0__default__isolated';
const LEAKED = 'model-a__claude-code-1.0.0__default__isolated-leaked';
const annotation = (id, runId, caseId, repeat, named, value, createdAt) => ({ annotation_id: id, run_id: runId, case_id: caseId, config_id: named, repeat, reviewer: 'owner', created_at: createdAt, scale: '1-5', value, notes: '', pair_id: null, pair_choice: null, pair_config_id: null, revealed: true, supersedes: null });

test('a leaked run and a clean run of one model are two configurations and never pool', (t) => {
  const { root, leaked, clean } = claudeRoot(t);
  const state = buildState(root, { validate: false });
  assert.deepEqual(Object.keys(state.configs).sort(), [LEGACY, LEAKED, 'model-b__claude-code-1.0.0__default']);
  assert.deepEqual(state.runs.filter((run) => [leaked.runId, clean.runId].includes(run.run_id)).map((run) => [run.run_id.slice(-6), run.setup_state, run.setup_missing]).sort(), [['h00001', 'leaked', [MDS, MEMORY]], ['h00002', 'kept out', []]]);
  assert.deepEqual([state.configs[LEAKED].setup_state, state.configs[LEAKED].setup_missing, state.configs[LEAKED].legacy_id], ['leaked', [MDS, MEMORY], LEGACY]);
  assert.deepEqual([state.configs[LEGACY].setup_state, state.configs[LEGACY].legacy_id, state.configs[LEGACY].user_config], ['kept out', LEGACY, 'isolated']);
  assert.equal(state.configs[LEAKED].short_label, 'Model A · claude-code · isolated (leaked)');
  assert.equal(state.configs['model-b__claude-code-1.0.0__default'].legacy_id, 'model-b__claude-code-1.0.0__default');
  assert.deepEqual(state.contexts.map((ctx) => ctx.comparison.axes), [['model', 'setup']], 'the setup state is an axis of the comparison');
  // The ladder report keeps them apart: c2 is solved by one and not by the other.
  const report = reportOf(root);
  assert.equal(report.configs.length, 3);
  const cases = Object.fromEntries(report.cases.map((entry) => [entry.case_id.replace('ladder-code-', ''), entry]));
  assert.deepEqual(cases.c2.per_config.map((entry) => [entry.config_id, entry.mean]), [[LEAKED, 0], [LEGACY, 1], ['model-b__claude-code-1.0.0__default', 0]]);
  assert.equal(cases.c2.information, 'disagree');
  assert.deepEqual(pairEvidence(report.cases, LEAKED, LEGACY), { shared: 3, a_only: 0, b_only: 1, sign_p: 1, mean_diff: -0.333 });
});

test('state.ladder lists every case of the suite versions in use, unrun ones included, and the pair table', (t) => {
  const { root } = claudeRoot(t);
  const { ladder } = buildState(root, { validate: false });
  assert.deepEqual(ladder.suites.map((suite) => [suite.id, suite.version, suite.cases.length]), [['ladder-answer', null, 0], ['ladder-code', '1.0.0', 6], ['ladder-agent', null, 0]]);
  const cases = Object.fromEntries(ladder.suites[1].cases.map((entry) => [entry.case_id.replace('ladder-code-', ''), [entry.information, entry.configs_n]]));
  assert.deepEqual(cases, { c1: ['all-solved', 3], c2: ['disagree', 3], c3: ['all-unsolved', 3], c4: ['no-data', 0], c5: ['no-data', 0], c6: ['no-data', 0] });
  assert.equal(ladder.pairs.length, 3);
  assert.ok(!JSON.stringify(ladder).includes('"band"'));
  // A root with no ladder table has no ladder.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-ladder-bare-'));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true, maxRetries: 5 }));
  assert.deepEqual(buildState(bare, { validate: false }).ladder.suites, []);
});

test('an old annotation that names the legacy id still attaches, per run, and the newer of two wins', (t) => {
  const { root, leaked, clean } = claudeRoot(t, {
    extra: ({ root: dir, leaked: a, clean: b }) => {
      write(path.join(dir, 'annotations', 'human@1.jsonl'), jsonl([
        annotation('x1', a.runId, 'ladder-code-c1', 0, LEGACY, 2, '2026-11-02T10:00:00.000Z'),
        annotation('x2', b.runId, 'ladder-code-c1', 0, LEGACY, 5, '2026-11-02T10:00:00.000Z'),
        // Repeat 1 of the leaked run: the legacy rating is older than the rating under the current id.
        annotation('x3', a.runId, 'ladder-code-c1', 1, LEGACY, 1, '2026-11-02T10:00:00.000Z'),
        annotation('x4', a.runId, 'ladder-code-c1', 1, LEAKED, 4, '2026-11-03T10:00:00.000Z'),
        // Repeat 1 of the clean run: the legacy rating is newer than the one under the current id, which is the same string.
        annotation('x5', b.runId, 'ladder-code-c1', 1, LEGACY, 3, '2026-11-03T10:00:00.000Z'),
      ]));
    },
  });
  const state = buildState(root, { validate: false });
  const human = (run, repeat) => state.observations.find((o) => o.run_id === run.runId && o.case_id === 'ladder-code-c1' && o.repeat === repeat).human?.value ?? null;
  assert.deepEqual([human(leaked, 0), human(clean, 0), human(leaked, 1), human(clean, 1)], [2, 5, 4, 3], 'one legacy id, two runs, two different rated observations');
  assert.deepEqual(state.annotations.map((item) => [item.annotation_id, item.config_id, item.stored_config_id ?? null]), [
    ['x1', LEAKED, LEGACY],
    ['x2', LEGACY, null],
    ['x3', LEAKED, LEGACY],
    ['x4', LEAKED, null],
    ['x5', LEGACY, null],
  ], 'shown under the id the run has now; the stored line keeps its own');
  assert.equal(fs.readFileSync(path.join(root, 'annotations', 'human@1.jsonl'), 'utf8').split('\n')[0].includes(`"config_id":"${LEGACY}"`), true, 'the stored line is not rewritten');
});

test('an old saved board that names the legacy id still shows that setup, and so does an old link', (t) => {
  const { root } = claudeRoot(t, {
    extra: ({ root: dir }) => {
      write(path.join(dir, 'boards', 'old.json'), `${JSON.stringify({ board_id: 'old', title: 'Old board', created_at: '2026-11-02T10:00:00.000Z', updated_at: '2026-11-02T10:00:00.000Z', context: { suite: 'ladder-code', prompt: 'js-function', cases: CASES.map((item) => item.case_id), repeats: 2 }, treatment_axis: 'none', configs: [LEGACY], view: {} })}\n`);
    },
  });
  const state = buildState(root, { validate: false });
  setData(state);
  const [board] = state.boards;
  const ctx = state.contexts[0];
  chooseContext(ctx.key, board.configs);
  // Before the split the id covered both Model A runs; both are shown, and the loaded Model B is not.
  assert.deepEqual([...S.sel].sort(), [LEGACY, LEAKED]);
  assert.equal(S.custom, true);
  chooseContext(ctx.key, [LEAKED]);
  assert.deepEqual(S.sel, [LEAKED], 'a current id still works');
  chooseContext(ctx.key, ['no-such__id']);
  assert.equal(S.custom, false, 'an unknown id falls back to every setup');
  assert.equal(S.sel.length, 3);
});

test('a pair rated after the split keeps both of its ids', (t) => {
  const { root } = claudeRoot(t, {
    extra: ({ root: dir, leaked }) => {
      write(path.join(dir, 'annotations', 'human@1.jsonl'), jsonl([{ ...annotation('p1', leaked.runId, 'ladder-code-c1', 0, LEAKED, null, '2026-11-03T10:00:00.000Z'), pair_id: 'pair-1', pair_choice: 'B', pair_config_id: LEGACY }]));
    },
  });
  const [item] = buildState(root, { validate: false }).annotations;
  assert.deepEqual([item.config_id, item.pair_config_id], [LEAKED, LEGACY]);
});

test('a board at the limit of eight setups keeps every setup it names; a smaller one also shows the sibling', (t) => {
  const { root } = claudeRoot(t);
  const state = buildState(root, { validate: false });
  const names = [...'abcdefgh'].map((letter) => `${letter}__h-1__default__isolated`);
  const sibling = `${names[0]}-leaked`;
  for (const id of names) state.configs[id] = { ...state.configs[LEGACY], id, legacy_id: id };
  state.configs[sibling] = { ...state.configs[LEAKED], id: sibling, legacy_id: names[0] };
  const [ctx] = state.contexts;
  ctx.config_ids = [names[0], sibling, ...names.slice(1)];
  setData(state);
  chooseContext(ctx.key, names);
  assert.deepEqual(S.sel, names);
  chooseContext(ctx.key, names.slice(0, 2));
  assert.deepEqual(S.sel, [names[0], sibling, names[1]]);
});

test('a suite that mixes prompt versions is refused alone in state.ladder; the other suites stay', (t) => {
  const root = makeRoot(t);
  write(path.join(root, 'datasets', 'ladder-answer', 'suite.yaml'), 'id: ladder-answer\nversion: "1.0.0"\n');
  write(path.join(root, 'datasets', 'ladder-answer', 'cases.jsonl'), jsonl([ladderCase('ladder-answer', 'a1', 1, 1), ladderCase('ladder-answer', 'a2', 2, 5)]));
  writeRun(root, 'r00001', 'model-a', rowsOf(SCORES['model-a']));
  writeRun(root, 'r00002', 'model-b', rowsOf(SCORES['model-b']), { promptVersion: '2' });
  writeRun(root, 'r00003', 'model-a', rowsOf({ a1: [1, 1], a2: [0, 0] }), { suite: 'ladder-answer' });
  writeRun(root, 'r00004', 'model-b', rowsOf({ a1: [1, 1], a2: [1, 1] }), { suite: 'ladder-answer' });
  ensureLedger(root);
  const { ladder } = buildState(root, { validate: false });
  assert.equal(ladder.error, undefined);
  const byId = Object.fromEntries(ladder.suites.map((suite) => [suite.id, suite]));
  assert.match(byId['ladder-code'].refused, /ladder-code@1\.0\.0 has counted runs with different prompt versions/);
  assert.deepEqual(byId['ladder-answer'].cases.map((entry) => [entry.case_id, entry.information]), [['ladder-answer-a1', 'all-solved'], ['ladder-answer-a2', 'disagree']]);
  assert.equal(byId['ladder-answer'].refused, null);
  assert.deepEqual(byId['ladder-code'].cases, [], 'a refused suite names no case set');
  assert.equal(ladder.pairs.length, 1, 'only the suite that is not refused gives a pair');
  assert.throws(() => reportOf(root), /different prompt versions/, 'the command still refuses and names --runs');
});

test('the exact sign test keeps a very small p; the text says it is small', () => {
  assert.equal(signTestP(22, 0), 4.76837158203125e-7);
  assert.equal(pairLine({ a_label: 'A', b_label: 'B', shared: 22, a_only: 22, b_only: 0, sign_p: signTestP(22, 0) }), 'A vs B: 22 shared, 22 and 0, p < 0.01');
});

test('two configurations with one short label are named by their ids in the report', (t) => {
  const root = makeRoot(t);
  writeRun(root, 'v00001', 'model-a', rowsOf(SCORES['model-a']));
  writeRun(root, 'v00002', 'model-a', rowsOf(SCORES['model-b']), { harnessVersion: '2.0.0' });
  writeRun(root, 'v00003', 'model-c', rowsOf(SCORES['model-c']));
  ensureLedger(root);
  const report = reportOf(root);
  assert.deepEqual(report.configs.map((config) => config.label).sort(), ['Model C · fake', 'model-a__fake-1.0.0__default', 'model-a__fake-2.0.0__default']);
  const twoVersions = report.pairs.find((pair) => pair.a.startsWith('model-a') && pair.b.startsWith('model-a'));
  assert.ok(pairLine(twoVersions).includes('model-a__fake-1.0.0__default') && pairLine(twoVersions).includes('model-a__fake-2.0.0__default'), pairLine(twoVersions));
});

test('the calibrate legend does not say unsolved tasks have no difference', (t) => {
  const { root } = mainRoot(t);
  const text = formatLadder(reportOf(root), { calibrate: true }).join('\n');
  assert.doesNotMatch(text, /no difference/);
  assert.match(text, /all-solved \/ all-unsolved = the configurations agree on solved or not/);
});

// ---- Stopped runs and tests with no scores ----

const shownFacts = (tries, passed, unscoredAnswers = 0) => ({ tries, errors: 0, failed: 0, lost: 0, mismatched: 0, checked: tries, passed, unchecked: 0, unscoredAnswers, decided: tries, rate: tries ? passed / tries : null, time: null, timed: 0, slow: null, price: null, pricePerPass: null, rating: null, ratings: 0 });

test('stored answers with no score are counted even when another setup has scores', () => {
  const said = answer({ setups: [{ id: 'a', name: 'A', facts: shownFacts(3, 3), errorReason: null }, { id: 'b', name: 'B', facts: shownFacts(0, 0, 58), errorReason: null }], cases: 3 });
  assert.equal(said.kind, 'few');
  assert.ok(said.more.includes('58 answers are stored with no counted score, so they count nowhere yet.'), JSON.stringify(said.more));
  const one = answer({ setups: [{ id: 'a', name: 'A', facts: shownFacts(3, 3), errorReason: null }, { id: 'b', name: 'B', facts: shownFacts(0, 0, 1), errorReason: null }], cases: 3 });
  assert.ok(one.more.includes('1 answer is stored with no counted score, so it counts nowhere yet.'), JSON.stringify(one.more));
});

test('answers of a run that does not count are counted as stored, even when old score files exist', (t) => {
  const root = makeRoot(t);
  writeRun(root, 'w00001', 'model-a', rowsOf({ c1: [1, 1] }), { status: 'running' });
  ensureLedger(root);
  const [ctx] = buildState(root, { validate: false }).contexts;
  assert.deepEqual(ctx.unscored_answers, { 'model-a__fake-1.0.0__default': 2 });
});

test('the review reveal names the user setup, so a leaked and a clean setup differ', (t) => {
  const { root } = claudeRoot(t);
  const state = buildState(root, { validate: false });
  setData(state);
  const reveal = (id) => whoText({ config_id: id, repeat: 0 });
  assert.equal(reveal(LEAKED), 'Model A · claude-code 1.0.0 · user setup leaked · try 1');
  assert.equal(reveal(LEGACY), 'Model A · claude-code 1.0.0 · user setup kept out · try 1');
  assert.equal(reveal('model-b__claude-code-1.0.0__default'), 'Model B · claude-code 1.0.0 · try 1');
});

test('an answer the evaluator left unchecked in a scored run is not also an unscored answer', (t) => {
  const root = makeRoot(t);
  writeRun(root, 'u00001', 'model-a', [{ slug: 'c1', repeat: 0, value: 1 }, { slug: 'c1', repeat: 1, value: null }]);
  ensureLedger(root);
  const [ctx] = buildState(root, { validate: false }).contexts;
  assert.deepEqual(ctx.unscored_answers, {});
});

const fakeNode = (id) => ({ id, innerHTML: '', textContent: '', hidden: false, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null });

function withDocument(t) {
  const nodes = new Map();
  globalThis.document = { getElementById: (id) => (nodes.has(id) ? nodes.get(id) : nodes.set(id, fakeNode(id)).get(id)), querySelectorAll: () => [], querySelector: () => null };
  t.after(() => delete globalThis.document);
  return (id) => globalThis.document.getElementById(id);
}

test('a stopped run with answers and no scores counts the unscored answers; a run with nothing says no answers yet', (t) => {
  const root = makeRoot(t);
  // 3 answers and 1 call that failed: the failure is not an answer.
  const stopped = writeRun(root, 'k00001', 'model-a', [{ slug: 'c1', repeat: 0, value: 1 }, { slug: 'c1', repeat: 1, value: 1 }, { slug: 'c2', repeat: 0, value: 1 }, { slug: 'c2', repeat: 1, error: { type: 'timeout' } }], { status: 'failed' });
  fs.rmSync(path.join(stopped.dir, 'scores'), { recursive: true });
  ensureLedger(root);
  const state = buildState(root, { validate: false });
  const [ctx] = state.contexts;
  assert.deepEqual(ctx.unscored_answers, { 'model-a__fake-1.0.0__default': 3 });
  assert.equal(ctx.aggregates['model-a__fake-1.0.0__default'].n, 0, 'the run counts nowhere');
  setData(state);
  chooseContext(ctx.key);
  const sentence = answer({ setups: shownSetups(), cases: 6 });
  assert.deepEqual([sentence.kind, sentence.sentences], ['empty', ['3 answers are stored with no counted score, so nothing counts yet.']]);
  assert.deepEqual(answer({ setups: [], cases: 6 }).sentences, ['No answers yet.']);
  const nothing = structuredClone(state);
  nothing.contexts[0].unscored_answers = {};
  setData(nothing);
  chooseContext(nothing.contexts[0].key);
  assert.deepEqual(answer({ setups: shownSetups(), cases: 6 }).sentences, ['No answers yet.']);
  // One answer: the verb agrees.
  nothing.contexts[0].unscored_answers = { 'model-a__fake-1.0.0__default': 1 };
  setData(nothing);
  assert.deepEqual(answer({ setups: shownSetups(), cases: 6 }).sentences, ['1 answer is stored with no counted score, so nothing counts yet.']);
});

test('a test with no scores shows no agreement line; with a score and no difference it does', (t) => {
  const node = withDocument(t);
  const root = makeRoot(t);
  const noScores = (key) => writeRun(root, key, `model-${key}`, rowsOf({ c1: [1, 1], c2: [1, 1] }), { status: 'failed' });
  for (const key of ['n00001', 'n00002']) fs.rmSync(path.join(noScores(key).dir, 'scores'), { recursive: true });
  const scored = (key) => writeRun(root, key, `model-${key}`, rowsOf({ c1: [1, 1], c2: [0, 0] }), { suiteVersion: '1.1.0' });
  scored('s00001');
  scored('s00002');
  ensureLedger(root);
  const state = buildState(root, { validate: false });
  setData(state);
  const unscoredCtx = state.contexts.find((item) => item.suite.version === '1.0.0');
  const scoredCtx = state.contexts.find((item) => item.suite.version === '1.1.0');

  // The stopped runs count nowhere, so their cells are empty: no score exists anywhere in this test.
  chooseContext(unscoredCtx.key);
  assert.equal(S.sel.length, 2);
  assert.equal(anyScored(unscoredCtx.cases, S.sel), false);
  renderCases();
  assert.doesNotMatch(node('cases').innerHTML, /agree on every case/);
  assert.equal(node('only-btn').hidden, true, 'the filter has nothing to filter');
  assert.equal(node('cases-note').textContent, '6 cases');

  // Two setups with the same scores on every case: they agree, and that is said.
  chooseContext(scoredCtx.key);
  S.only = true;
  assert.equal(anyScored(scoredCtx.cases, S.sel), true);
  renderCases();
  assert.match(node('cases').innerHTML, /The setups agree on every case\./);
  assert.equal(node('only-btn').hidden, false);
  S.only = null;
});

test('the setup chip: leaked, partly kept out and unknown are said on their own line; kept out and loaded are not', (t) => {
  const node = withDocument(t);
  const root = makeRoot(t);
  writeRun(root, 'p00001', 'model-a', rowsOf({ c1: [1, 1] }), { harnessName: 'claude-code', harnessSettings: asked(CLAUDE_BASE) });
  writeRun(root, 'p00002', 'model-b', rowsOf({ c1: [1, 1] }), { harnessName: 'claude-code', harnessSettings: asked([...CLAUDE_BASE, MDS, MEMORY]) });
  writeRun(root, 'p00003', 'model-c', rowsOf({ c1: [1, 1] }), { harnessName: 'command-code', harnessSettings: asked(['--no-skills']) });
  writeRun(root, 'p00004', 'model-d', rowsOf({ c1: [1, 1] }), { harnessName: 'declared-cli', harnessSettings: asked(['--no-user']) });
  writeRun(root, 'p00005', 'model-e', rowsOf({ c1: [1, 1] }), { harnessName: 'claude-code' });
  ensureLedger(root);
  const state = buildState(root, { validate: false });
  setData(state);
  chooseContext(state.contexts[0].key);
  renderSetups();
  const html = node('setups').innerHTML;
  const chips = [...html.matchAll(/<span class="who-sub warn" data-setup-state="([^"]+)" title="([^"]*)">([^<]*)<\/span>/g)].map((match) => [match[1], match[3], match[2]]);
  assert.deepEqual(chips.sort(), [
    ['leaked', 'user setup leaked', `user setup leaked (missing ${MDS}, ${MEMORY})`],
    ['partly kept out', 'user setup partly kept out', 'user setup partly kept out'],
    ['unknown', 'user setup unknown', 'user setup unknown'],
  ]);
  assert.match(html, /claude-code 1\.0\.0 · user setup kept out</, 'a kept out setup keeps its quiet word in the harness line');
  assert.equal((html.match(/user setup leaked/g) || []).length, 2, 'the chip text and its title; not repeated in the harness line');
});

test('two setups that differ only in the state of the user setup get different names in tables and charts', () => {
  const base = { display_name: 'Claude Haiku', model_key: 'm', harness: { name: 'claude-code', version: '1' }, effort: null };
  const names = chartNames([
    { ...base, id: 'a', setup_state: 'leaked' },
    { ...base, id: 'b', setup_state: 'kept out' },
    { ...base, id: 'c', harness: { name: 'codex', version: '2' }, setup_state: 'loaded' },
  ]);
  assert.equal(names.get('a'), 'Claude Haiku · claude-code 1 · default · user setup leaked');
  assert.equal(names.get('b'), 'Claude Haiku · claude-code 1 · default · user setup kept out');
  assert.equal(names.get('c'), 'Claude Haiku · codex', 'a name that is already unique stays short');
});
