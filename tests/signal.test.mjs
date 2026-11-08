// node lab signal: before a run, can it give a trustable signal? Each test builds a small data root
// with fake runs (vouched for in the evidence ledger) and an experiment, then asks for the report
// through the library, the command line or the dashboard route, and checks literal values.
// No model is called.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { createServer } from '../dashboard/server.mjs';
import { signTestP } from '../lab/lib/ladder.mjs';
import { ensureLedger } from '../lab/lib/ledger.mjs';
import { loadSuite } from '../lab/lib/repo.mjs';
import { NEEDED, disagreementsNeeded, signalReport } from '../lab/lib/signal.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'lab', 'cli.mjs');

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const jsonl = (rows) => rows.map((row) => `${JSON.stringify(row)}\n`).join('');
const taskId = (n) => `fx-sig-t${String(n).padStart(2, '0')}`;
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
// Task numbers -> the scores of one setup, the same on every repeat.
const scoresOf = (solved, unsolved = []) => ({ ...Object.fromEntries(solved.map((n) => [n, [1, 1]])), ...Object.fromEntries(unsolved.map((n) => [n, [0, 0]])) });

/** A data root: registry, prompt, one suite of `tasks` cases at version 1.0.0, and a declared harness with no isolation flags. */
function makeRoot(t, { tasks = 8, version = '1.0.0' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-signal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const models = ['m-a', 'm-b', 'm-c'].map((key) => `  ${key}:\n    provider: fake\n    model: ${key}\n    display_name: ${key}\n`).join('');
  write(path.join(root, 'configs', 'models.yaml'), `models:\n${models}`);
  write(path.join(root, 'configs', 'harnesses.yaml'), 'harnesses:\n  plain-cli:\n    bin: plaincli\n    args: [run, "{prompt}"]\n');
  write(path.join(root, 'prompts', 'ptest', 'prompt.yaml'), 'id: ptest\ncurrent: "1"\nvariables:\n  - question\n');
  write(path.join(root, 'prompts', 'ptest', 'v1.yaml'), 'version: "1"\nmessages:\n  - role: user\n    content: "{{question}}"\n');
  write(path.join(root, 'datasets', 'fx-sig', 'suite.yaml'), `id: fx-sig\nversion: "${version}"\ndescription: fixture for the signal tests\n`);
  write(path.join(root, 'datasets', 'fx-sig', 'cases.jsonl'), jsonl(range(1, tasks).map((n) => ({ case_id: taskId(n), input: { question: `q${n}` }, expected: { answer: String(n) } }))));
  return root;
}

const suiteSha = (root) => loadSuite(root, 'fx-sig').sha256;

/** One stored run of one model. rows: { <task number>: [score per repeat] }. */
function addRun(root, { rand, model, rows, harness = 'claude-code', setup = 'kept out', promptVersion = '1', sha = suiteSha(root), version = '1.0.0', tokens = () => 5 }) {
  const runId = `20261101T100000Z__fx-sig__fx-sig__${rand}`;
  const flags = setup === 'kept out' ? ADAPTERS[harness].isolation.args : setup === 'leaked' ? ['--strict-mcp-config'] : [];
  const manifest = {
    run_id: runId,
    created_at: '2026-11-01T10:00:00.000Z',
    finished_at: '2026-11-01T10:30:00.000Z',
    status: 'completed',
    suite: { id: 'fx-sig', version, sha256: sha },
    prompt: { id: 'ptest', version: promptVersion, sha256: 'b'.repeat(64) },
    experiment: { id: 'fx-exp', suite: 'fx-sig', prompt: 'ptest', repeats: 2 },
    models: [{ model_key: model, provider: 'fake', model, params: {} }],
    repeats: 2,
    evaluators: [{ id: 'workspace-tests', version: '1', dimension: 'quality' }],
    harness: {
      name: harness,
      version: '1.0.0',
      entrypoint: 'headless',
      access_method: 'subscription',
      platform: 'win32',
      session_id: null,
      settings: setup === 'loaded' ? {} : { user_config: 'isolated', user_config_flags: flags },
    },
  };
  const dir = path.join(root, 'results', runId);
  const flat = Object.entries(rows).flatMap(([n, values]) => values.map((value, repeat) => ({ n: Number(n), repeat, value })));
  write(path.join(dir, 'run.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  write(
    path.join(dir, 'raw.jsonl'),
    jsonl(flat.map(({ n, repeat }) => ({ run_id: runId, case_id: taskId(n), model_key: model, repeat, started_at: manifest.created_at, latency_ms: 1000, tool_calls: 0, skills_used: [], request: { prompt_id: 'ptest', prompt_version: promptVersion, messages: [], system_prompt: null, params: {} }, response: { text: 'x', finish_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: tokens(n, repeat) }, cost_usd: null, error: null, metadata: {} }))),
  );
  write(
    path.join(dir, 'scores', 'workspace-tests@1.jsonl'),
    jsonl(flat.map(({ n, repeat, value }) => ({ run_id: runId, case_id: taskId(n), model_key: model, repeat, evaluator_id: 'workspace-tests', evaluator_version: '1', dimension: 'quality', value, passed: value === 1, details: {} }))),
  );
}

/** An experiment file; targets: [[model, harness], ...]. */
function addExperiment(root, targets, { name = 'fx-exp', extra = '', userConfig = 'isolated' } = {}) {
  const lines = targets.map(([model, harness]) => `  - model: ${model}\n    harness: ${harness}`).join('\n');
  const file = path.join(root, 'experiments', `${name}.yaml`);
  write(file, `id: ${name}\nsuite: fx-sig\nprompt: ptest\nrepeats: 2\nuser_config: ${userConfig}\ntargets:\n${lines}\nevaluators:\n  - id: workspace-tests\n    version: "1"\n    dimension: quality\n${extra}`);
  return file;
}

const A_B = [['m-a', 'claude-code'], ['m-b', 'claude-code']];

/** Vouch for every run written so far. */
const vouch = (root) => ensureLedger(root, { log: () => {} });

/** Every file under a folder with its hash, to prove that a command writes nothing. */
function listing(dir) {
  const out = {};
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

const labCli = (root, args) => {
  const env = { ...process.env, LAB_ROOT: root };
  delete env.LAB_DATA;
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd: REPO, env, encoding: 'utf8', timeout: 120_000 });
  return { code: run.status, out: run.stdout, err: run.stderr };
};

// ---- the arithmetic ----------------------------------------------------------------------------

test('two setups need 6 disagreements, all one way: 2 x (1/2)^6 = 0.03125 is under 0.05, and 2 x (1/2)^5 = 0.0625 is not', () => {
  assert.equal(signTestP(6, 0), 0.03125);
  assert.equal(signTestP(5, 0), 0.0625);
  assert.equal(NEEDED, 6);
  assert.equal(disagreementsNeeded(), 6);
  assert.equal(disagreementsNeeded(0.0625), 6, 'p of five equals 0.0625, so it is not under it');
  assert.equal(disagreementsNeeded(0.07), 5, 'a looser line lets five through');
  // One disagreement the other way spoils six: n = 7, k = 1, 2 x (1 + 7) / 128.
  assert.equal(signTestP(6, 1), 0.125);
});

// ---- task classes and the three results --------------------------------------------------------

test('each task class: all solved, all unsolved, disagree, and a task only one setup has run reads as no history, not agreement', (t) => {
  const root = makeRoot(t, { tasks: 10 });
  // Tasks 1-2: both solve. 3-4: neither. 5-7: only A. 8: only B. 9: only A has run it (and solved it). 10: nobody has run it.
  addRun(root, { rand: 'a00001', model: 'm-a', rows: scoresOf([1, 2, 5, 6, 7, 9], [3, 4, 8]) });
  addRun(root, { rand: 'a00002', model: 'm-b', rows: scoresOf([1, 2, 8], [3, 4, 5, 6, 7]) });
  vouch(root);
  const report = signalReport(root, addExperiment(root, A_B));
  assert.equal(report.planned_calls, 40, '2 setups x 10 tasks x 2 tries');
  assert.deepEqual(report.tasks, { no_history: 2, all_solved: 2, all_unsolved: 2, disagree: 4 });
  assert.deepEqual(Object.fromEntries(report.task_list.map((item) => [item.case_id.slice(-3), item.class])), {
    t01: 'all_solved', t02: 'all_solved', t03: 'all_unsolved', t04: 'all_unsolved', t05: 'disagree', t06: 'disagree', t07: 'disagree', t08: 'disagree', t09: 'no_history', t10: 'no_history',
  });
  assert.equal(report.calls_low_information, 8, '2 all-solved tasks x 2 setups x 2 tries');
  assert.equal(report.pairs.length, 1);
  const [pair] = report.pairs;
  assert.deepEqual([pair.shared, pair.a_only, pair.b_only, pair.predicted_disagreements, pair.needed, pair.unseen], [8, 3, 1, 4, 6, 2]);
  // Three against one over 8 shared tasks: p = 2 x (1 + 4) / 16 = 0.625. Even if both unseen tasks went one way: 5 against 1, 2 x (1 + 6) / 64 = 0.21875.
  assert.deepEqual([pair.sign_p, pair.best_case_p, pair.status], [0.625, 0.21875, 'unreachable']);
  assert.equal(report.result, 'low signal');
});

test('a pair with 6 disagreements all one way is worth running; the same data with 5 is low signal', (t) => {
  const six = makeRoot(t, { tasks: 8 });
  // A solves tasks 1-6, B solves none of them; tasks 7-8 both solve. Every task has history for both.
  addRun(six, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)), tokens: (n) => 10 * n });
  addRun(six, { rand: 'a00002', model: 'm-b', rows: scoresOf([7, 8], range(1, 6)), tokens: (n) => 20 * n });
  vouch(six);
  const worth = signalReport(six, addExperiment(six, A_B));
  assert.equal(worth.result, 'worth running');
  assert.deepEqual(worth.tasks, { no_history: 0, all_solved: 2, all_unsolved: 0, disagree: 6 });
  assert.equal(worth.calls_low_information, 8);
  assert.deepEqual([worth.pairs[0].shared, worth.pairs[0].a_only, worth.pairs[0].b_only, worth.pairs[0].predicted_disagreements, worth.pairs[0].needed, worth.pairs[0].sign_p, worth.pairs[0].status], [8, 6, 0, 6, 6, 0.03125, 'reachable']);
  // Stored median output tokens per call: A 10 x (1..8) twice = 10 10 20 20 ... 80 80, median (40 + 50) / 2 = 45; 16 calls. B: 20 x ... = 90 x 16.
  assert.deepEqual(worth.output_tokens.map((item) => [item.estimate, item.median_per_call]), [[720, 45], [1440, 90]]);

  const five = makeRoot(t, { tasks: 8 });
  addRun(five, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)) });
  addRun(five, { rand: 'a00002', model: 'm-b', rows: scoresOf([6, 7, 8], range(1, 5)) });
  vouch(five);
  const low = signalReport(five, addExperiment(five, A_B));
  assert.deepEqual([low.pairs[0].predicted_disagreements, low.pairs[0].sign_p, low.pairs[0].status], [5, 0.0625, 'unreachable']);
  assert.equal(low.result, 'low signal');
  assert.match(low.reasons.join('\n'), /No planned task lacks history, and p stays at 0\.0625, over 0\.05\./);
});

test('a pair with too little history is open: the run could still reach 6, so the result is unknown', (t) => {
  const root = makeRoot(t, { tasks: 12 });
  // Tasks 1-4 are the only ones both have run; A alone solves all four. Eight tasks have no history for the pair.
  addRun(root, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 4)) });
  addRun(root, { rand: 'a00002', model: 'm-b', rows: scoresOf([], range(1, 4)) });
  vouch(root);
  const report = signalReport(root, addExperiment(root, A_B));
  const [pair] = report.pairs;
  // 4 against 0: p = 2 / 16 = 0.125, over 0.05. With 8 unseen tasks all one way, 12 against 0: p = 2 / 4096.
  assert.deepEqual([pair.shared, pair.predicted_disagreements, pair.unseen, pair.sign_p, pair.status], [4, 4, 8, 0.125, 'open']);
  assert.equal(report.result, 'unknown');
  assert.deepEqual(report.tasks, { no_history: 8, all_solved: 0, all_unsolved: 0, disagree: 4 });
});

test('with no history at all the result is unknown and no number is invented', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  const report = signalReport(root, addExperiment(root, A_B));
  assert.equal(report.result, 'unknown');
  assert.equal(report.planned_calls, 32);
  assert.deepEqual(report.tasks, { no_history: 8, all_solved: 0, all_unsolved: 0, disagree: 0 });
  assert.deepEqual(report.output_tokens.map((item) => item.estimate), [null, null]);
  assert.equal(report.pairs[0].predicted_disagreements, null);
  assert.equal(report.pairs[0].sign_p, null);
  assert.match(report.reasons.join('\n'), /2 setups of 2 have no history for fx-sig@1\.0\.0/);
});

test('only one chosen setup has history: every task reads no history, even those it solved, and nothing counts as agreement', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  addRun(root, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)) });
  vouch(root);
  const report = signalReport(root, addExperiment(root, A_B));
  assert.deepEqual(report.tasks, { no_history: 8, all_solved: 0, all_unsolved: 0, disagree: 0 });
  assert.equal(report.calls_low_information, 0);
  assert.equal(report.result, 'unknown');
  assert.equal(report.pairs[0].shared, 0);
  assert.equal(report.pairs[0].predicted_disagreements, null);
  assert.deepEqual(report.setups.map((setup) => setup.history), [true, false]);
  assert.equal(report.output_tokens[0].estimate, 80, 'the setup with history has a median of 5 per call over 16 calls');
  assert.equal(report.output_tokens[1].estimate, null);
});

test('when every task is already solved by every chosen setup the result is low signal, with that reason', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  addRun(root, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)) });
  addRun(root, { rand: 'a00002', model: 'm-b', rows: scoresOf(range(1, 8)) });
  vouch(root);
  const report = signalReport(root, addExperiment(root, A_B));
  assert.equal(report.result, 'low signal');
  assert.equal(report.calls_low_information, 32);
  assert.equal(report.planned_calls, 32);
  assert.deepEqual(report.tasks, { no_history: 0, all_solved: 8, all_unsolved: 0, disagree: 0 });
  assert.equal(report.reasons[0], 'Every one of the 32 planned calls repeats a task that every chosen setup already solved. A new run cannot add information.');
});

test('an experiment with zero planned calls is low signal', (t) => {
  const root = makeRoot(t, { tasks: 4 });
  const report = signalReport(root, addExperiment(root, A_B, { extra: 'cases: []\n' }));
  assert.equal(report.planned_calls, 0);
  assert.equal(report.result, 'low signal');
  assert.equal(report.reasons[0], 'The experiment plans 0 calls, so a run cannot show anything.');
});

test('a plan of fewer than 6 tasks cannot reach p under 0.05 whatever the history, so it is low signal and says why', (t) => {
  const root = makeRoot(t, { tasks: 5 });
  const report = signalReport(root, addExperiment(root, A_B));
  assert.equal(report.result, 'low signal');
  assert.equal(report.pairs[0].status, 'unreachable');
  // All five tasks one way: 2 x (1/2)^5 = 0.0625.
  assert.equal(report.pairs[0].best_case_p, 0.0625);
  assert.equal(report.reasons[0], 'The plan has 5 tasks. Two setups need at least 6 tasks that one solves and the other does not, so no pair can reach p under 0.05.');
  assert.equal(report.pairs[0].predicted_disagreements, null, 'no history, so no predicted count');
});

test('a suite whose counted runs mix prompt versions is refused: the result is unknown, with the reason, and the history is not used', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  addRun(root, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 6), [7, 8]), promptVersion: '1' });
  addRun(root, { rand: 'a00002', model: 'm-b', rows: scoresOf([], range(1, 8)), promptVersion: '2' });
  vouch(root);
  const report = signalReport(root, addExperiment(root, A_B));
  assert.equal(report.result, 'unknown');
  assert.match(report.reasons[0], /^fx-sig@1\.0\.0 has counted runs with different prompt versions \(ptest@1, ptest@2\); scores of different prompts are not comparable\./);
  assert.deepEqual(report.tasks, { no_history: 8, all_solved: 0, all_unsolved: 0, disagree: 0 });
  assert.deepEqual(report.output_tokens.map((item) => item.estimate), [null, null]);
});

test('history from another prompt version, another suite version or changed suite content is not used', (t) => {
  const other = makeRoot(t, { tasks: 8 });
  addRun(other, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)), promptVersion: '2' });
  addRun(other, { rand: 'a00002', model: 'm-b', rows: scoresOf([], range(1, 8)), promptVersion: '2' });
  vouch(other);
  const prompt = signalReport(other, addExperiment(other, A_B));
  assert.equal(prompt.result, 'unknown');
  assert.match(prompt.reasons.join('\n'), /used prompt ptest@2; this experiment uses ptest@1/);

  const old = makeRoot(t, { tasks: 8 });
  addRun(old, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)), version: '0.9.0' });
  addRun(old, { rand: 'a00002', model: 'm-b', rows: scoresOf([], range(1, 8)), version: '0.9.0' });
  vouch(old);
  const version = signalReport(old, addExperiment(old, A_B));
  assert.equal(version.result, 'unknown');
  assert.deepEqual(version.tasks, { no_history: 8, all_solved: 0, all_unsolved: 0, disagree: 0 });
  assert.match(version.reasons.join('\n'), /No counted run of fx-sig@1\.0\.0 is stored\. Counted runs of 0\.9\.0 are not used/);

  const changed = makeRoot(t, { tasks: 8 });
  addRun(changed, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)), sha: 'c'.repeat(64) });
  vouch(changed);
  assert.match(signalReport(changed, addExperiment(changed, A_B)).reasons.join('\n'), /1 stored run of fx-sig 1\.0\.0 recorded other suite content/);
});

// ---- setup state -------------------------------------------------------------------------------

test('a leaked setup next to a clean one: leaked history is never pooled, and the reason says so', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  addRun(root, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)), setup: 'kept out' });
  // B ran only with the flags missing, and under a loaded setup with the same scores.
  addRun(root, { rand: 'a00002', model: 'm-b', rows: scoresOf([], range(1, 8)), setup: 'leaked' });
  addRun(root, { rand: 'a00003', model: 'm-b', rows: scoresOf([], range(1, 8)), setup: 'loaded' });
  vouch(root);
  const report = signalReport(root, addExperiment(root, A_B));
  assert.deepEqual(report.setups.map((setup) => [setup.setup_state, setup.history]), [['kept out', true], ['kept out', false]]);
  assert.match(report.setups[0].config_id, /__isolated$/);
  assert.equal(report.result, 'unknown');
  assert.deepEqual(report.tasks, { no_history: 8, all_solved: 0, all_unsolved: 0, disagree: 0 });
  assert.match(report.reasons.join('\n'), /m-b · claude-code: stored runs exist only as leaked and loaded\. They are never pooled with the planned setup \(kept out, answer tools default\)\./);
});

test('history from a configuration with other answer tools is not pooled: OpenCode runs with its tools off, a stored run with them on is another setup', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  addRun(root, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)) });
  addRun(root, { rand: 'a00002', model: 'm-b', harness: 'opencode', rows: scoresOf([], range(1, 8)) });
  vouch(root);
  const report = signalReport(root, addExperiment(root, [['m-a', 'claude-code'], ['m-b', 'opencode']]));
  assert.deepEqual(report.setups.map((setup) => [setup.history, setup.config_id.endsWith('__no-tools')]), [[true, false], [false, true]]);
  assert.equal(report.result, 'unknown');
  assert.match(report.reasons.join('\n'), /m-b · opencode: stored runs exist only as answer tools default\. They are never pooled with the planned setup \(kept out, answer tools off\)\./);
});

test('a setup that cannot be kept out is flagged, and a pair with it is not clean', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  addRun(root, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)) });
  vouch(root);
  const report = signalReport(root, addExperiment(root, [['m-a', 'claude-code'], ['m-b', 'plain-cli']]));
  assert.deepEqual(report.setups.map((setup) => setup.setup_state), ['kept out', 'unknown']);
  assert.equal(report.pairs[0].status, 'confounded');
  assert.match(report.reasons.join('\n'), /m-b · plain-cli was asked to stay out of your setup, but the lab cannot show that it does/);
  // The same experiment with the setup loaded asks for nothing to be kept out.
  const loaded = signalReport(root, addExperiment(root, [['m-a', 'claude-code'], ['m-b', 'plain-cli']], { name: 'fx-loaded', userConfig: 'loaded' }));
  assert.deepEqual(loaded.setups.map((setup) => setup.setup_state), ['loaded', 'loaded']);
});

test('a setup that can be only partly kept out is named in the reasons', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  const report = signalReport(root, addExperiment(root, [['m-a', 'claude-code'], ['m-b', 'command-code']]));
  assert.deepEqual(report.setups.map((setup) => setup.setup_state), ['kept out', 'partly kept out']);
  assert.match(report.reasons.join('\n'), /m-b · command-code can be only partly kept out of your setup\./);
  assert.doesNotMatch(report.reasons.join('\n'), /m-a · claude-code can be only partly/);
});

// ---- check quality -----------------------------------------------------------------------------

test('check quality reads reports/audit, and a suite with no audit, or an audit of other content, reads not audited', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  const file = addExperiment(root, A_B);
  assert.deepEqual(signalReport(root, file).checks, { state: 'not audited', kill_rate: null });
  assert.match(signalReport(root, file).reasons.join('\n'), /The hidden checks are not audited/);

  const audit = (sha) => ({ kind: 'checks', suite: { id: 'fx-sig', version: '1.0.0', sha256: sha, frozen: false }, totals: { tasks: 8, audited: 6, kill_rate: 0.75 } });
  write(path.join(root, 'reports', 'audit', 'fx-sig@1.0.0.json'), `${JSON.stringify(audit(suiteSha(root)))}\n`);
  const audited = signalReport(root, file);
  assert.deepEqual([audited.checks.state, audited.checks.kill_rate, audited.checks.audited_tasks, audited.checks.tasks], ['audited', 0.75, 6, 8]);
  assert.match(audited.reasons.join('\n'), /The hidden checks are audited: they caught 75% of the wrong answers made for the audit\./);

  write(path.join(root, 'reports', 'audit', 'fx-sig@1.0.0.json'), `${JSON.stringify(audit('d'.repeat(64)))}\n`);
  assert.equal(signalReport(root, file).checks.state, 'not audited');
  assert.match(signalReport(root, file).reasons.join('\n'), /stored audit of the hidden checks is for other suite content/);
});

// ---- the command and the dashboard route -------------------------------------------------------

test('node lab signal prints the report, --json prints the same numbers, and neither writes anything', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  addRun(root, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)) });
  addRun(root, { rand: 'a00002', model: 'm-b', rows: scoresOf([7, 8], range(1, 6)) });
  vouch(root);
  const file = addExperiment(root, A_B);
  const before = listing(root);
  const text = labCli(root, ['signal', file]);
  assert.equal(text.code, 0, text.err);
  for (const line of ['Planned calls: 32 (2 setups x 8 tasks x 2 tries)', 'Tasks by what history says: 0 no history, 2 all solved, 0 all unsolved, 6 disagree', 'Calls with little chance of new information: 8', 'Check quality: not audited', 'Result: worth running']) {
    assert.ok(text.out.includes(line), `missing: ${line}\n${text.out}`);
  }
  assert.match(text.out, /predicted 6 of 6 needed \(6 and 0, over 8 shared tasks\), reachable/);
  const json = labCli(root, ['signal', file, '--json']);
  assert.equal(json.code, 0, json.err);
  assert.deepEqual(JSON.parse(json.out), signalReport(root, file));
  assert.deepEqual(listing(root), before, 'a signal check writes nothing');
});

test('node lab signal narrows like node lab run: --models and --repeats change the planned calls', (t) => {
  const root = makeRoot(t, { tasks: 8 });
  const file = addExperiment(root, A_B);
  const run = labCli(root, ['signal', file, '--models', 'm-a', '--repeats', '1', '--json']);
  assert.equal(run.code, 0, run.err);
  const report = JSON.parse(run.out);
  assert.equal(report.planned_calls, 8);
  assert.equal(report.setups.length, 1);
  assert.equal(report.result, 'unknown');
  assert.match(report.reasons[0], /One setup is planned/);
});

test('a bad use exits non-zero with a clear message: no path, a missing file, an unknown suite, a bad option', (t) => {
  const root = makeRoot(t, { tasks: 4 });
  const none = labCli(root, ['signal']);
  assert.notEqual(none.code, 0);
  assert.match(none.err, /Usage: node lab signal <experiment\.yaml>/);
  assert.equal(none.out, '');
  const missing = labCli(root, ['signal', path.join(root, 'experiments', 'nope.yaml')]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.err, /Error: No experiment file at .*nope\.yaml/);
  write(path.join(root, 'experiments', 'bad.yaml'), 'id: bad\nsuite: no-such-suite\nprompt: ptest\ntargets:\n  - model: m-a\n    harness: claude-code\n');
  const unknown = labCli(root, ['signal', path.join(root, 'experiments', 'bad.yaml')]);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.err, /^Error: /);
  const file = addExperiment(root, A_B);
  const option = labCli(root, ['signal', file, '--repeats', '0']);
  assert.notEqual(option.code, 0);
  assert.match(option.err, /repeats must be a positive integer/);
});

async function withServer(root, fn) {
  const server = createServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const get = (url) =>
    new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: url }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
      }).on('error', reject);
    });
  try {
    await fn(get);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/signal gives the same report as the command, takes the Run page narrowing, and refuses anything else', async (t) => {
  const root = makeRoot(t, { tasks: 8 });
  addRun(root, { rand: 'a00001', model: 'm-a', rows: scoresOf(range(1, 8)) });
  addRun(root, { rand: 'a00002', model: 'm-b', rows: scoresOf([7, 8], range(1, 6)) });
  vouch(root);
  const file = addExperiment(root, A_B);
  const before = listing(root);
  await withServer(root, async (get) => {
    const full = await get('/api/signal?experiment=fx-exp.yaml');
    assert.equal(full.status, 200);
    assert.deepEqual(full.json, signalReport(root, file));
    assert.equal(full.json.result, 'worth running');
    const narrow = await get('/api/signal?experiment=fx-exp.yaml&models=m-a&cases=fx-sig-t01,fx-sig-t02&repeats=3');
    assert.equal(narrow.status, 200);
    assert.equal(narrow.json.planned_calls, 6);
    for (const bad of ['', '?experiment=../fx-exp.yaml', '?experiment=fx-exp.txt', '?experiment=nope.yaml', '?experiment=fx-exp.yaml&repeats=0', '?experiment=fx-exp.yaml&models=-x', '?experiment=fx-exp.yaml&cases=fx-sig-nope']) {
      const refused = await get(`/api/signal${bad}`);
      assert.equal(refused.status, 400, bad);
      assert.equal(typeof refused.json.error, 'string');
    }
  });
  assert.deepEqual(listing(root), before, 'the route writes nothing');
});
