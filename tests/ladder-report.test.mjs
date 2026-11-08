// node lab ladder: the report is shaped from the derived view (rows that count) and
// printed from that shape. These tests build a small data root with fake runs, vouch
// for them in the evidence ledger, and check literal values: solved counts, means,
// verdicts and the negative-discrimination flag.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, ladderCommand, ladderReport, verdictFor } from '../lab/commands/ladder.mjs';
import { ensureLedger } from '../lab/lib/ledger.mjs';
import { ladderStatus, loadLadder } from '../lab/lib/ladder.mjs';
import { loadSuite } from '../lab/lib/repo.mjs';
import { buildState } from '../lab/lib/state.mjs';

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

function manifest(runId, modelKey, { status = 'completed', suiteVersion = '1.0.0', suiteSha = 'a'.repeat(64), promptVersion = '1', evaluatorVersion = '1' } = {}) {
  return {
    run_id: runId,
    created_at: '2026-11-01T10:00:00.000Z',
    finished_at: status === 'completed' ? '2026-11-01T10:30:00.000Z' : null,
    status,
    suite: { id: 'ladder-code', version: suiteVersion, sha256: suiteSha },
    prompt: { id: 'js-function', version: promptVersion, sha256: 'b'.repeat(64) },
    experiment: { id: 'ladder-code', suite: 'ladder-code', prompt: 'js-function', repeats: 2 },
    models: [{ model_key: modelKey, provider: 'fake', model: modelKey, params: {} }],
    repeats: 2,
    evaluators: [{ ...QUALITY, version: evaluatorVersion }],
    harness: { name: 'fake', version: '1.0.0', entrypoint: 'headless', access_method: 'subscription', platform: 'win32', session_id: null, settings: {} },
    ...(status === 'running' ? { runner: { pid: 1, heartbeat_at: '2026-11-01T10:00:00.000Z' } } : {}),
  };
}

// One run: rows = [{ slug, repeat, value }] or [{ slug, repeat, error: { type } }].
function writeRun(root, rand, modelKey, rows, options = {}) {
  const evaluatorVersion = options.evaluatorVersion ?? '1';
  const runId = `20261101T100000Z__ladder-code__ladder-code__${rand}`;
  const dir = path.join(root, 'results', runId);
  write(path.join(dir, 'run.json'), `${JSON.stringify(manifest(runId, modelKey, options), null, 2)}\n`);
  const raw = rows.map(({ slug, repeat, error }) => ({
    run_id: runId,
    case_id: `ladder-code-${slug}`,
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
    .map(({ slug, repeat, value }) => ({ run_id: runId, case_id: `ladder-code-${slug}`, model_key: modelKey, repeat, evaluator_id: 'workspace-tests', evaluator_version: evaluatorVersion, dimension: 'quality', value, passed: value === 1, details: {} }));
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

test('a case verdict: in band, move to a tier, or rework; a case with its mean outside the band keeps its distance', (t) => {
  const { root } = mainRoot(t);
  const cases = Object.fromEntries(reportOf(root).cases.map((entry) => [entry.case_id.replace('ladder-code-', ''), entry]));
  const view = (entry) => [entry.mean, entry.configs_n, entry.verdict, entry.move_to, entry.distance];
  assert.deepEqual(view(cases.c1), [1, 3, 'in band', null, 0]);
  assert.deepEqual(view(cases.c6), [0.833, 3, 'in band', null, 0]);
  // c2 (medium, 5 min): configuration means 1, 0.5 and 0 give 0.5, 0.15 under the band 0.65 to 0.95; the hard band holds 0.5 and 5 min is within 4x of 8 to 30.
  assert.deepEqual(view(cases.c2), [0.5, 3, 'move to hard', 3, 0.15]);
  // c3 (hard, 20 min): mean 0 is held by the supreme band only, and 20 min is below 120 / 4.
  assert.deepEqual(view(cases.c3), [0, 3, 'rework', null, 0.35]);
  // c4 (extra-hard, 60 min): 0, 0.5 and 1 give 0.5; the hard band holds it.
  assert.deepEqual(view(cases.c4), [0.5, 3, 'move to hard', 3, 0.05]);
  // c5 (supreme, 200 min): 1, 0 and 0 give 0.333; the extra-hard band holds it and 200 min is under 120 * 4.
  assert.deepEqual(view(cases.c5), [0.333, 3, 'move to extra-hard', 4, 0.133]);
  assert.deepEqual(cases.c2.per_config.map((entry) => [entry.config_id.split('__')[0], entry.mean, entry.n, entry.solved]), [['model-a', 1, 2, true], ['model-b', 0.5, 2, false], ['model-c', 0, 2, false]]);
});

test('negative discrimination: a weaker configuration solves a task that a stronger one fails on every repeat', (t) => {
  const { root } = mainRoot(t);
  const flagged = reportOf(root).cases.filter((entry) => entry.flags.length);
  assert.deepEqual(flagged.map((entry) => entry.case_id), ['ladder-code-c4']);
  assert.deepEqual(flagged[0].flags.map((flag) => [flag.flag, flag.solved_by.split('__')[0], flag.failed_by.split('__')[0]]), [['negative discrimination', 'model-c', 'model-a']]);
});

test('verdictFor: band edges are inside, and the factor-of-4 limit decides move or rework', () => {
  const ladder = loadLadder(REPO);
  const medium = ladder.byLevel.get(2);
  const view = (value, minutes) => verdictFor({ mean: value, tier: medium, minutes, ladder }).verdict;
  assert.equal(view(0.65, 5), 'in band');
  assert.equal(view(0.95, 5), 'in band');
  assert.equal(view(null, 5), 'no data');
  // 0.4 is held by the hard band (8 to 30 min): 2 min is the limit (8 / 4), 120 min the other (30 * 4).
  assert.equal(view(0.4, 2), 'move to hard');
  assert.equal(view(0.4, 1.9), 'rework');
  assert.equal(view(0.4, 120), 'move to hard');
  // Past the hard range the next band that holds 0.4, extra-hard (30 to 120 min), takes it: 121 min is under 120 * 4.
  assert.equal(view(0.4, 121), 'move to extra-hard');
  assert.equal(view(0.4, 481), 'rework');
  // 0.97 is held by the easy band only (0 to 2 min): up to 8 min is allowed.
  assert.equal(view(0.97, 8), 'move to easy');
  assert.equal(view(0.97, 9), 'rework');
  // A hard case at 0.4 is inside its own band.
  assert.equal(verdictFor({ mean: 0.4, tier: ladder.byLevel.get(3), minutes: 20, ladder }).verdict, 'in band');
  // 0.12 for a hard case: the extra-hard band (0.1 to 0.45) is nearer than supreme (0 to 0.2).
  assert.equal(verdictFor({ mean: 0.12, tier: ladder.byLevel.get(3), minutes: 20, ladder }).verdict, 'move to extra-hard');
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
  assert.match(lines.find((line) => line.startsWith('ladder-code-c2')), /2 medium\s+0\.50\s+3\s+0\.65-0\.95\s+move to hard$/);
  assert.match(lines.find((line) => line.startsWith('ladder-code-c4')), /move to hard\s+negative discrimination$/);
  assert.match(text, /Verdicts: 2 in band, 3 move, 1 rework\./);
  assert.match(text, /ladder-code-c4: solved by model-c__fake-1\.0\.0__default, failed on every repeat by model-a__fake-1\.0\.0__default/);
});

test('--json prints the same data, with the problems and the filters', (t) => {
  const { root } = mainRoot(t);
  const lines = [];
  const report = ladderCommand(root, { json: true, suite: 'code', log: (line) => lines.push(line) });
  const parsed = JSON.parse(lines.join('\n'));
  assert.deepEqual(parsed.configs, JSON.parse(JSON.stringify(report.configs)));
  assert.deepEqual(Object.keys(parsed).sort(), ['cases', 'configs', 'filters', 'problems', 'tiers', 'versions', 'warnings']);
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
  assert.match(text, /ladder-code-c1\s+1 easy\s+n\/a\s+0\s+0\.90-1\.00\s+no data/);
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
  assert.deepEqual([c1.mean, c1.configs_n, c1.verdict], [1, 1, 'in band'], 'the old score 0 is not averaged in');
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
  assert.equal(old.cases.find((entry) => entry.case_id === 'ladder-code-c2').mean, 1);
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
  const byCase = Object.fromEntries(report.cases.map((entry) => [entry.case_id, entry.mean]));
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
