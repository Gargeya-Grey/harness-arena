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
import { ladderCommand, ladderReport, verdictFor } from '../lab/commands/ladder.mjs';
import { ensureLedger } from '../lab/lib/ledger.mjs';
import { ladderStatus, loadLadder } from '../lab/lib/ladder.mjs';
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

function manifest(runId, modelKey, { status = 'completed' } = {}) {
  return {
    run_id: runId,
    created_at: '2026-11-01T10:00:00.000Z',
    finished_at: status === 'completed' ? '2026-11-01T10:30:00.000Z' : null,
    status,
    suite: { id: 'ladder-code', version: '1.0.0', sha256: 'a'.repeat(64) },
    prompt: { id: 'js-function', version: '1', sha256: 'b'.repeat(64) },
    experiment: { id: 'ladder-code', suite: 'ladder-code', prompt: 'js-function', repeats: 2 },
    models: [{ model_key: modelKey, provider: 'fake', model: modelKey, params: {} }],
    repeats: 2,
    evaluators: [QUALITY],
    harness: { name: 'fake', version: '1.0.0', entrypoint: 'headless', access_method: 'subscription', platform: 'win32', session_id: null, settings: {} },
    ...(status === 'running' ? { runner: { pid: 1, heartbeat_at: '2026-11-01T10:00:00.000Z' } } : {}),
  };
}

// One run: rows = [{ slug, repeat, value }] or [{ slug, repeat, error: { type } }].
function writeRun(root, rand, modelKey, rows, options = {}) {
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
    .map(({ slug, repeat, value }) => ({ run_id: runId, case_id: `ladder-code-${slug}`, model_key: modelKey, repeat, evaluator_id: 'workspace-tests', evaluator_version: '1', dimension: 'quality', value, passed: value === 1, details: {} }));
  write(path.join(dir, 'raw.jsonl'), jsonl(raw));
  write(path.join(dir, 'scores', 'workspace-tests@1.jsonl'), jsonl(scores));
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
  assert.deepEqual(Object.keys(parsed).sort(), ['cases', 'configs', 'filters', 'problems', 'tiers']);
  assert.deepEqual(parsed.filters, { suite: 'ladder-code', runs: null });
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
