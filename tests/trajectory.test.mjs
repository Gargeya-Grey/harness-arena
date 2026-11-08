// node lab trace: the steps of one attempt are read from a harness event stream, and the
// report is built from the rows that count. The harness samples in
// tests/fixtures/harness/trace/ are real rows (redacted), except codex.synthetic, which
// is marked synthetic in its README. Every expected value below is written out.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { traceCommand } from '../lab/commands/trace.mjs';
import { ensureLedger } from '../lab/lib/ledger.mjs';
import { checkClaim, claimOf, cleanPath, hasStepParser, median, readShareBeforeFirstEdit, readTraceEvents, repeatedFailures, rowKey, saidDone, scrub, traceSteps } from '../lab/lib/trajectory.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'harness', 'trace');

const readRows = (name) => fs.readFileSync(path.join(FIXTURES, `${name}.events.jsonl`), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const eventsOf = (name) => readRows(name).map((row) => row.event);
const step = (i, kind, ok, extra = {}) => ({ i, kind, ok, path: null, command: null, ...extra });

// ---- traceSteps: one saved real sample per harness ---------------------------------------

test('Claude Code: tool_use blocks are steps, and the matching tool_result gives ok', () => {
  assert.deepEqual(traceSteps('claude-code', eventsOf('claude-code')), [
    step(0, 'shell', true, { command: 'cd "<workdir>" && ls -R src test && cat src/slugify.mjs && echo "-----" && cat test/*' }),
    step(1, 'edit', true, { path: 'src/slugify.mjs' }),
    step(2, 'test', true, { command: 'cd "<workdir>" && node --test 2>&1 | tail -n 12' }),
  ]);
});

test('OpenCode: a failed shell command has ok false from its exit code; a tool the harness reports completed has ok true', () => {
  assert.deepEqual(traceSteps('opencode', eventsOf('opencode')), [
    step(0, 'read', true),
    step(1, 'read', true, { path: 'package.json' }),
    step(2, 'read', true, { path: 'test/slugify.test.mjs' }),
    step(3, 'read', true, { path: 'src/slugify.mjs' }),
    step(4, 'test', false, { command: 'cd <workdir> && node --test' }),
    step(5, 'test', false, { command: 'node --test' }),
    step(6, 'edit', true, { path: 'src/slugify.mjs' }),
    step(7, 'test', true, { command: 'node --test' }),
  ]);
});

test('Command Code: tool_queued is the step; tool_errored gives ok false; streamed thinking and text give no step', () => {
  const events = eventsOf('command-code');
  assert.ok(events.filter((event) => event.event?.type === 'thinking_delta').length >= 3, 'the sample holds streamed thinking');
  assert.deepEqual(traceSteps('command-code', events), [
    step(0, 'read', true, { path: '.' }),
    step(1, 'read', true, { path: 'package.json' }),
    step(2, 'read', true, { path: 'src/slugify.mjs' }),
    step(3, 'read', false, { path: 'test' }),
    step(4, 'read', true, { path: 'test' }),
    step(5, 'read', true, { path: 'test/slugify.test.mjs' }),
    step(6, 'edit', true, { path: 'src/slugify.mjs' }),
    step(7, 'test', true, { command: 'node --test' }),
  ]);
});

test('Command Code: a shell command with "Exit code: N" at the top of its output failed, and one without it did not', () => {
  const queued = (id, command) => ({ type: 'event', event: { type: 'tool_queued', toolCallId: id, toolName: 'shell_command', input: { command } } });
  const completed = (id, text) => ({ type: 'event', event: { type: 'tool_completed', toolCallId: id, toolName: 'shell_command', result: [{ type: 'text', text }] } });
  const steps = traceSteps('command-code', [queued('a', 'node --test'), completed('a', 'Exit code: 1\n✖ plain numbers'), queued('b', 'node --test'), completed('b', '✔ plain numbers\nℹ fail 0\n'), queued('c', 'ls'), completed('c', 'Exit code: 0\nx')]);
  assert.deepEqual(steps.map((item) => [item.kind, item.ok]), [['test', false], ['test', true], ['shell', true]]);
});

test('Codex real sample: the row has no tool event, so it gives no step (the sample is thin: Codex could not read the workspace)', () => {
  const events = eventsOf('codex');
  assert.ok(events.some((event) => event.type === 'item.completed' && event.item.type === 'agent_message'));
  assert.deepEqual(traceSteps('codex', events), []);
});

test('Codex synthetic sample: command_execution takes ok from exit_code, file_change gives an edit per path, item.started and unknown items give nothing', () => {
  assert.deepEqual(traceSteps('codex', eventsOf('codex.synthetic')), [
    step(0, 'test', false, { command: 'node --test' }),
    step(1, 'edit', true, { path: 'src/slugify.mjs' }),
    step(2, 'edit', true, { path: 'src/digits.mjs' }),
    step(3, 'shell', null, { command: 'Get-Content src/slugify.mjs' }),
    step(4, 'test', true, { command: 'node --test' }),
  ]);
});

// ---- Failure cases -----------------------------------------------------------------------

test('an unknown event gives no step and does not crash', () => {
  const junk = [null, undefined, 7, 'text', [], {}, { type: 'something.new', item: { type: 'command_execution' } }, { type: 'tool_use' }, { type: 'assistant', message: { content: 'not a list' } }, { type: 'event', event: { type: 'tool_queued' } }];
  for (const harness of ['claude-code', 'codex', 'command-code', 'opencode']) assert.deepEqual(traceSteps(harness, junk), [], harness);
  assert.deepEqual(traceSteps('no-such-harness', eventsOf('opencode')), []);
  assert.deepEqual(traceSteps('opencode', null), []);
  assert.equal(hasStepParser('gemini-cli'), false);
  assert.equal(hasStepParser('opencode'), true);
});

test('an unknown tool name is a step of kind other; a tool event the harness left without a result has ok null', () => {
  const use = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [] } }, { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'a.mjs' } }] } };
  assert.deepEqual(traceSteps('claude-code', [use]), [step(0, 'other', null), step(1, 'read', null, { path: 'a.mjs' })]);
  const open = { type: 'tool_use', part: { id: 'p', type: 'tool', tool: 'shell', state: { status: 'completed', input: { command: 'dir' } } } };
  assert.deepEqual(traceSteps('opencode', [open]), [step(0, 'shell', null, { command: 'dir' })], 'a shell tool with no exit code does not state its result');
});

test('a tool step in a home folder reports the path inside the call folder, or only the file name', () => {
  assert.equal(cleanPath('~\\AppData\\Local\\Temp\\model-lab-AbC123\\src\\a.mjs'), 'src/a.mjs');
  assert.equal(cleanPath('C:\\Users\\someone\\project\\b.mjs'), '<outside>/b.mjs');
  assert.equal(cleanPath('/home/someone/c.mjs'), '<outside>/c.mjs');
  assert.equal(cleanPath('src/d.mjs'), 'src/d.mjs');
  assert.equal(cleanPath(''), null);
  assert.equal(scrub('cd C:\\Users\\someone\\x && cd ~\\AppData\\Local\\Temp\\model-lab-AbC123 && ls /home/someone/y'), 'cd ~\\x && cd <workdir> && ls ~/y');
});

test('the median of an even count is the mean of the middle two', () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([11000, 11533]), 11266.5);
  assert.equal(median([5, 1, 9]), 5);
  assert.equal(median([7]), 7);
  assert.equal(median([]), null);
  assert.equal(median([null, 2, undefined, 4]), 3, 'a missing value is not a zero');
});

test('process facts: reads before the first edit, and a command that fails again', () => {
  assert.equal(readShareBeforeFirstEdit([step(0, 'read', true), step(1, 'edit', true), step(2, 'read', true), step(3, 'read', true)]), 1 / 3);
  assert.equal(readShareBeforeFirstEdit([step(0, 'read', true), step(1, 'read', true)]), null, 'no edit');
  assert.equal(readShareBeforeFirstEdit([step(0, 'edit', true)]), null, 'no read');
  const fail = (i, command) => step(i, 'test', false, { command });
  assert.equal(repeatedFailures([fail(0, 'node --test'), fail(1, 'node  --test'), fail(2, 'node --test'), fail(3, 'npm test')]), 2, 'the first failure is not a repeat');
  assert.equal(repeatedFailures([step(0, 'test', null, { command: 'node --test' }), step(1, 'test', null, { command: 'node --test' })]), 0, 'a result the harness does not state is not a failure');
});

// ---- Claims in the final message -----------------------------------------------------------

const PASSING = [step(0, 'test', false, { command: 'node --test' }), step(1, 'edit', true, { path: 'a.mjs' }), step(2, 'test', true, { command: 'node --test' })];
const FAILING = PASSING.slice(0, 1);

test('a true claim: the message says the tests pass and the last test command passed', () => {
  assert.deepEqual(checkClaim('I fixed `src/slugify.mjs`. All 3 tests now pass with `node --test`.', PASSING), { claim: 'pass', status: 'consistent' });
  assert.deepEqual(checkClaim('Tests still fail on the digits case.', FAILING), { claim: 'fail', status: 'consistent' });
});

test('a contradicted claim: the message names a test result that the events show to be different', () => {
  assert.deepEqual(checkClaim('Done. All tests pass.', FAILING), { claim: 'pass', status: 'contradicted' });
  assert.deepEqual(checkClaim('The tests still fail.', PASSING), { claim: 'fail', status: 'contradicted' });
});

test('an unknown claim: missing evidence is never a contradiction', () => {
  assert.deepEqual(checkClaim('All tests pass.', []), { claim: 'pass', status: 'unknown' }, 'no test command in the events');
  assert.deepEqual(checkClaim('All tests pass.', [step(0, 'test', null, { command: 'node --test' })]), { claim: 'pass', status: 'unknown' }, 'the harness does not state the result');
  assert.deepEqual(checkClaim('All tests pass.', [step(0, 'shell', false, { command: 'dir' })]), { claim: 'pass', status: 'unknown' }, 'a failed command that is not a test run');
});

test('a message without a test result is no claim; a message that says it could not run is no claim', () => {
  for (const text of ['Added tests covering each case.', 'Changed files: src/cart.mjs', 'Updated the docs.','I couldn’t access the project files: the workspace is mounted read-only. I haven’t changed anything or run the tests.', 'The tests should pass now.', 'Run the tests to see that they pass if you like.', null, undefined, 42]) {
    assert.deepEqual(checkClaim(text, FAILING), { claim: null, status: null }, String(text));
  }
  assert.equal(claimOf('Fixed it. 12 pass, 0 failures, no failing tests. All tests pass.'), 'pass');
  assert.equal(claimOf('3 tests pass but lint fails.'), null, 'a sentence that gives both results is not read');
});

test('said done is a separate fact: finished work in the message, and not a blocked agent', () => {
  assert.equal(saidDone('Done. All 30 tests pass (13 existing untouched, 17 new).'), true);
  assert.equal(saidDone('Implemented the change.'), true);
  assert.equal(saidDone('I couldn’t access the project files. I haven’t changed anything or run the tests.'), false);
  assert.equal(saidDone('The workspace is read-only. Updated nothing.'), false);
  assert.equal(saidDone(''), false);
  assert.equal(saidDone(null), false);
});

// ---- Reading event files ---------------------------------------------------------------

const line = (caseId, model, repeat, event) => `${JSON.stringify({ case_id: caseId, model_key: model, repeat, event })}\n`;

test('events are read line by line: only the wanted rows, streamed noise counted but not kept, a bad line skipped', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-trace-read-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'harness-events.ndjson');
  const tool = { type: 'event', event: { type: 'tool_queued', toolCallId: 'x', toolName: 'read_file', input: { file_path: 'a'.repeat(5000) } } };
  fs.writeFileSync(file, [
    line('c1', 'm', 0, { type: 'event', event: { type: 'thinking_delta', delta: 'hm' } }),
    line('c1', 'm', 0, tool),
    'this line is not json\n',
    line('c2', 'm', 0, tool),
    line('c1', 'm', 1, { type: 'event', event: { type: 'text_delta', delta: 'hi' } }),
    line('c"quoted', 'm', 0, tool),
  ].join(''));
  const rows = await readTraceEvents(file, new Set([rowKey('c1', 'm', 0), rowKey('c1', 'm', 1), rowKey('c"quoted', 'm', 0), rowKey('missing', 'm', 0)]));
  assert.deepEqual([...rows.keys()].sort(), ['c"quoted|m|0', 'c1|m|0', 'c1|m|1']);
  assert.equal(rows.get('c1|m|0').lines, 2);
  assert.equal(rows.get('c1|m|0').events.length, 1, 'the thinking delta is counted, not kept');
  assert.equal(rows.get('c1|m|0').events[0].event.input.file_path.length, 600, 'long text is cut');
  assert.deepEqual(rows.get('c1|m|1'), { lines: 1, events: [] }, 'a row with events and no tool step is present with zero steps');
  assert.equal((await readTraceEvents(path.join(dir, 'none.ndjson'), new Set(['x']))).size, 0);
});

// ---- node lab trace, on a small data root ------------------------------------------------

const QUALITY = { id: 'workspace-tests', version: '1', dimension: 'quality' };
const TIER_NAMES = ['easy', 'medium', 'hard', 'extra-hard', 'supreme'];
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const jsonl = (rows) => rows.map((row) => `${JSON.stringify(row)}\n`).join('');

const caseOf = (slug, level, minutes) => ({
  case_id: `ladder-agent-${slug}`,
  input: { task: slug, workspace: slug },
  expected: { check: slug },
  tags: [`tier-${level}-${TIER_NAMES[level - 1]}`],
  metadata: { tier: { level, name: TIER_NAMES[level - 1], human_minutes: minutes, basis: 'fixture for the trace tests' } },
});
const CASES = [caseOf('a1', 1, 1), caseOf('a2', 2, 5), caseOf('a3', 3, 20), caseOf('a4', 4, 60)];

function manifest(runId, modelKey, harness, status) {
  return {
    run_id: runId,
    created_at: '2026-11-01T10:00:00.000Z',
    finished_at: status === 'completed' ? '2026-11-01T10:30:00.000Z' : null,
    status,
    suite: { id: 'ladder-agent', version: '1.0.0', sha256: 'a'.repeat(64) },
    prompt: { id: 'agent-task', version: '1', sha256: 'b'.repeat(64) },
    experiment: { id: 'ladder-agent', suite: 'ladder-agent', prompt: 'agent-task', repeats: 1 },
    models: [{ model_key: modelKey, provider: 'fake', model: modelKey, params: {} }],
    repeats: 1,
    evaluators: [QUALITY],
    harness: { name: harness, version: '1.0.0', entrypoint: 'headless', access_method: 'subscription', platform: 'win32', session_id: null, settings: {} },
    ...(status === 'running' ? { runner: { pid: 1, heartbeat_at: '2026-11-01T10:00:00.000Z' } } : {}),
  };
}

// rows: [{ slug, value, tokens, text, events }]; events null means the stream has no line for the row.
function writeRun(root, rand, modelKey, harness, rows, status = 'completed') {
  const runId = `20261101T100000Z__ladder-agent__ladder-agent__${rand}`;
  const dir = path.join(root, 'results', runId);
  write(path.join(dir, 'run.json'), `${JSON.stringify(manifest(runId, modelKey, harness, status), null, 2)}\n`);
  write(path.join(dir, 'raw.jsonl'), jsonl(rows.map(({ slug, tokens, text }) => ({
    run_id: runId,
    case_id: `ladder-agent-${slug}`,
    model_key: modelKey,
    repeat: 0,
    started_at: '2026-11-01T10:00:00.000Z',
    latency_ms: 1000,
    tool_calls: 0,
    skills_used: [],
    request: { prompt_id: 'agent-task', prompt_version: '1', messages: [], system_prompt: null, params: {} },
    response: { text, finish_reason: 'end_turn' },
    usage: { input_tokens: 1, output_tokens: tokens },
    cost_usd: null,
    error: null,
    metadata: {},
  }))));
  write(path.join(dir, 'scores', 'workspace-tests@1.jsonl'), jsonl(rows.map(({ slug, value }) => ({ run_id: runId, case_id: `ladder-agent-${slug}`, model_key: modelKey, repeat: 0, evaluator_id: 'workspace-tests', evaluator_version: '1', dimension: 'quality', value, passed: value === 1, details: {} }))));
  write(path.join(dir, 'harness-events.ndjson'), rows.filter(({ events }) => events).flatMap(({ slug, events }) => events.map((event) => line(`ladder-agent-${slug}`, modelKey, 0, event))).join(''));
  return dir;
}

// The OpenCode sample without its last tool call: the last test run in it failed.
const OPENCODE = eventsOf('opencode');
const OPENCODE_FAILING = OPENCODE.filter((_, index) => index !== OPENCODE.map((event) => event.type).lastIndexOf('tool_use'));
const COMMAND_CODE = eventsOf('command-code');
const TEXT_ONLY = [{ type: 'text', part: { id: 'p', type: 'text', text: 'Updated the docs.' } }];

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-trace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  fs.cpSync(path.join(REPO, 'configs', 'ladder.yaml'), path.join(root, 'configs', 'ladder.yaml'));
  write(path.join(root, 'datasets', 'ladder-agent', 'suite.yaml'), 'id: ladder-agent\nversion: "1.0.0"\n');
  write(path.join(root, 'datasets', 'ladder-agent', 'cases.jsonl'), jsonl(CASES));
  // model-a on OpenCode: a1 is true, a2 is contradicted (hidden check failed too), a3 has no events, a4 used no tool.
  writeRun(root, 'a00001', 'model-a', 'opencode', [
    { slug: 'a1', value: 1, tokens: 100, text: 'Fixed it. All tests pass.', events: OPENCODE },
    { slug: 'a2', value: 0, tokens: 200, text: 'Done: all tests pass now.', events: OPENCODE_FAILING },
    { slug: 'a3', value: 1, tokens: 300, text: 'All tests pass.', events: null },
    { slug: 'a4', value: 1, tokens: 400, text: 'Updated the docs.', events: TEXT_ONLY },
  ]);
  // model-b on Command Code: a2 says it could not run the tests, a4 says done and fails the hidden check.
  writeRun(root, 'a00002', 'model-b', 'command-code', [
    { slug: 'a1', value: 1, tokens: 50, text: 'All 3 tests pass.', events: COMMAND_CODE },
    { slug: 'a2', value: 1, tokens: 70, text: 'I could not run the tests.', events: COMMAND_CODE },
    { slug: 'a3', value: 1, tokens: 90, text: 'Fixed. All tests pass.', events: COMMAND_CODE },
    { slug: 'a4', value: 0, tokens: 110, text: 'Implemented the change.', events: COMMAND_CODE },
  ]);
  // A run that is still running counts nowhere, even with tool events.
  writeRun(root, 'b00001', 'model-running', 'opencode', [{ slug: 'a1', value: 1, tokens: 1, text: 'x', events: OPENCODE }], 'running');
  ensureLedger(root);
  return root;
}

async function trace(root, values = {}) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const code = await traceCommand(root, [], values);
    return { code, text: lines.join('\n') };
  } finally {
    console.log = original;
  }
}
const asJson = async (root, values = {}) => JSON.parse((await trace(root, { ...values, json: true })).text);
const byModel = (report) => Object.fromEntries(report.configs.map((config) => [config.config_id.split('__')[0], config]));

test('per configuration: tool calls, tests run, reads before the first edit, repeated failing commands, median output tokens', async (t) => {
  const report = await asJson(makeRoot(t));
  assert.deepEqual(report.configs.map((config) => config.config_id.split('__')[0]).sort(), ['model-a', 'model-b'], 'a run that is still running counts nowhere');
  assert.equal(report.rows_counted, 8);
  const { 'model-a': a, 'model-b': b } = byModel(report);
  // OpenCode sample: 8 steps (3 test runs); the failing copy: 7 steps (2 test runs); the text-only row: 0 steps.
  assert.deepEqual([a.rows, a.rows_with_events, a.rows_missing_events], [4, 3, 1]);
  assert.deepEqual(a.tool_calls, { total: 15, median_per_row: 7, rows: 3 });
  assert.deepEqual(a.tests_run, { total: 5, rows_with_a_test: 2 });
  assert.deepEqual(a.reads_before_first_edit, { share: 1, rows: 2 });
  assert.equal(a.repeated_failing_commands, 0);
  assert.deepEqual(a.output_tokens, { median: 250, rows: 4 }, 'the median of 100, 200, 300 and 400');
  // Command Code sample: 8 steps in each of 4 rows.
  assert.deepEqual([b.rows, b.rows_with_events, b.rows_missing_events], [4, 4, 0]);
  assert.deepEqual(b.tool_calls, { total: 32, median_per_row: 8, rows: 4 });
  assert.deepEqual(b.tests_run, { total: 4, rows_with_a_test: 4 });
  assert.deepEqual(b.output_tokens, { median: 80, rows: 4 }, 'the median of 50, 70, 90 and 110');
});

test('a row with no events is missing, never zero; a row with events and no tool step is zero', async (t) => {
  const root = makeRoot(t);
  const report = await asJson(root);
  const a = byModel(report)['model-a'];
  const rows = Object.fromEntries(report.rows.filter((row) => row.config_id === a.config_id).map((row) => [row.case_id.replace('ladder-agent-', ''), row]));
  assert.equal(rows.a3.events, 'missing');
  assert.equal(rows.a3.process, null);
  assert.equal(rows.a4.events, 'present');
  assert.equal(rows.a4.process.tool_calls, 0);
  assert.equal(a.tool_calls.rows, 3, 'the missing row is not in the tool-call median');
  const text = (await trace(root)).text;
  assert.match(text, /model-a__\S+: 1 row\(s\) have no events\. They are missing from the process columns, not counted as zero\./);
});

test('claims: a contradicted claim is counted alone, missing evidence is unknown, a failed hidden check is a separate count', async (t) => {
  const { 'model-a': a, 'model-b': b } = byModel(await asJson(makeRoot(t)));
  assert.deepEqual(a.claims, { consistent: 1, contradicted: 1, unknown: 1, rows_checked: 4 });
  assert.deepEqual(b.claims, { consistent: 2, contradicted: 0, unknown: 0, rows_checked: 4 }, '"I could not run the tests" and "Implemented the change" are no claim');
  // a2 (model-a): said done, hidden check 0. a4 (model-b): said done, hidden check 0. The unknown a3 and the no-tool a4 of model-a are not.
  assert.deepEqual(a.said_done_check_failed, { count: 1, rows_checked: 4 });
  assert.deepEqual(b.said_done_check_failed, { count: 1, rows_checked: 4 });
});

test('output tokens per solved task reads the tasks both configurations solved', async (t) => {
  const report = await asJson(makeRoot(t));
  const [a, b] = ['model-a', 'model-b'].map((model) => byModel(report)[model].config_id);
  // model-a solved a1, a3, a4; model-b solved a1, a2, a3. Shared: a1 and a3.
  assert.deepEqual(report.pairs, [{ a, b, tasks: 2, median_output_tokens: { [a]: 200, [b]: 70 } }]);
  assert.deepEqual(report.shared_solved, { tasks: 2, medians: { [a]: 200, [b]: 70 } });
  assert.equal(byModel(report)['model-a'].output_tokens.median, 250, 'the plain median reads every counted row, the shared one only shared tasks');
});

test('--runs and --suite-version choose the rows; a bare version needs --suite', async (t) => {
  const root = makeRoot(t);
  const only = await asJson(root, { runs: 'a00001' });
  assert.deepEqual(only.configs.map((config) => config.config_id.split('__')[0]), ['model-a']);
  assert.deepEqual(only.pairs, []);
  const versioned = await asJson(root, { suite: 'ladder-agent', 'suite-version': ['1.0.0'] });
  assert.equal(versioned.rows_counted, 8);
  await assert.rejects(() => trace(root, { 'suite-version': ['1.0.0'] }), /needs --suite/);
  await assert.rejects(() => trace(root, { suite: 'nope' }), /--suite must be one of/);
  await assert.rejects(() => traceCommand(root, ['extra'], {}), /options only/);
});

test('the text report has the columns, the notes and no home path; --json parses and has no home path', async (t) => {
  const root = makeRoot(t);
  const { code, text } = await trace(root);
  assert.equal(code, 0);
  assert.match(text, /^Trace of 8 counted row\(s\) from 2 run\(s\)\./);
  assert.match(text, /rows with events {2}tool calls \(median\/row, total\) {2}tests run/);
  assert.match(text, /model-a__\S+ +3\/4 +7, 15 +5 in 2 row\(s\) +1\.00 \(2 rows\) +0 +250 +1 \/ 1 \/ 1 +1\b/);
  assert.match(text, /Median output tokens per solved task, on the tasks both configurations solved:/);
  assert.match(text, /It is not a claim of dishonesty\./);
  const json = (await trace(root, { json: true })).text;
  assert.ok(JSON.parse(json).configs.length === 2);
  for (const output of [text, json]) assert.doesNotMatch(output, /AppData|[A-Za-z]:\\|\\Users\\|\/Users\/|\/home\/|model-lab-[A-Za-z0-9]{6}/);
});

test('the CLI prints the report, exits 0, reads the rows without changing any file of the data root', (t) => {
  const root = makeRoot(t);
  const listing = () => fs.readdirSync(root, { recursive: true }).filter((name) => fs.statSync(path.join(root, name)).isFile()).sort().map((name) => `${name} ${fs.statSync(path.join(root, name)).size} ${fs.statSync(path.join(root, name)).mtimeMs}`);
  const before = listing();
  const run = spawnSync(process.execPath, [path.join(REPO, 'lab', 'cli.mjs'), 'trace', '--json'], { env: { ...process.env, LAB_ROOT: root }, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).rows_counted, 8);
  assert.deepEqual(listing(), before);
});
