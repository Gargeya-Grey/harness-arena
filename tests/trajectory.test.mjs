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
import * as lib from '../lab/lib/trajectory.mjs';
import { traceCommand } from '../lab/commands/trace.mjs';
import { ensureLedger, eventsState, runFiles } from '../lab/lib/ledger.mjs';
import { checkClaim, claimOf, cleanPath, forEachTraceRow, hasStepParser, median, readShareBeforeFirstEdit, repeatedFailures, rowKey, saidDone, scrub, toolKind, traceSteps } from '../lab/lib/trajectory.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'harness', 'trace');

const readRows = (name) => fs.readFileSync(path.join(FIXTURES, `${name}.events.jsonl`), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const eventsOf = (name) => readRows(name).map((row) => row.event);
const step = (i, kind, ok, extra = {}) => ({ i, kind, ok, path: null, command: null, ...extra });
// The steps without their identity and runner fields, which the tests below check apart.
const plain = (steps) => steps.map(({ command_id: _id, runners: _runners, ...rest }) => rest);

// ---- traceSteps: one saved real sample per harness ---------------------------------------

test('Claude Code: tool_use blocks are steps, and the matching tool_result gives ok; a test piped to tail has an unknown result', () => {
  const steps = traceSteps('claude-code', eventsOf('claude-code'));
  assert.deepEqual(plain(steps), [
    step(0, 'read', true, { command: 'cd "<workdir>" && ls -R src test && cat src/slugify.mjs && echo "-----" && cat test/*' }),
    step(1, 'edit', true, { path: 'src/slugify.mjs' }),
    step(2, 'test', null, { command: 'cd "<workdir>" && node --test 2>&1 | tail -n 12' }),
  ]);
  assert.deepEqual(steps.map((item) => item.runners), [[], [], ['node --test']]);
});

test('OpenCode: a failed test run has ok false from its exit code; a shell parse error is no test run; a tool the harness reports completed has ok true', () => {
  assert.deepEqual(plain(traceSteps('opencode', eventsOf('opencode'))), [
    step(0, 'read', true),
    step(1, 'read', true, { path: 'package.json' }),
    step(2, 'read', true, { path: 'test/slugify.test.mjs' }),
    step(3, 'read', true, { path: 'src/slugify.mjs' }),
    step(4, 'shell', false, { command: 'cd <workdir> && node --test' }),
    step(5, 'test', false, { command: 'node --test' }),
    step(6, 'edit', true, { path: 'src/slugify.mjs' }),
    step(7, 'test', true, { command: 'node --test' }),
  ]);
});

test('Command Code: tool_queued is the step; tool_errored gives ok false; streamed thinking and text give no step', () => {
  const events = eventsOf('command-code');
  assert.ok(events.filter((event) => event.event?.type === 'thinking_delta').length >= 3, 'the sample holds streamed thinking');
  assert.deepEqual(plain(traceSteps('command-code', events)), [
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
  const steps = traceSteps('command-code', [queued('a', 'node --test'), completed('a', 'Exit code: 1\n✖ plain numbers'), queued('b', 'node --test'), completed('b', '✔ plain numbers\nℹ fail 0\n'), queued('c', 'mkdir out'), completed('c', 'Exit code: 0\nx')]);
  assert.deepEqual(steps.map((item) => [item.kind, item.ok]), [['test', false], ['test', true], ['shell', true]]);
});

test('Codex real sample: the row has no tool event, so it gives no step (the sample is thin: Codex could not read the workspace)', () => {
  const events = eventsOf('codex');
  assert.ok(events.some((event) => event.type === 'item.completed' && event.item.type === 'agent_message'));
  assert.deepEqual(traceSteps('codex', events), []);
});

test('Codex synthetic sample: command_execution takes ok from exit_code, one file_change is one tool call, item.started and unknown items give nothing', () => {
  assert.deepEqual(plain(traceSteps('codex', eventsOf('codex.synthetic'))), [
    step(0, 'test', false, { command: 'node --test' }),
    step(1, 'edit', true, { path: 'src/slugify.mjs' }),
    step(2, 'read', null, { command: 'Get-Content src/slugify.mjs' }),
    step(3, 'test', true, { command: 'node --test' }),
  ]);
});

// ---- Review round 1: what a step may say about a command ----------------------------------

const claudeCall = (id, name, input, content, isError) => [
  { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] } },
];
const bash = (id, command, output, isError = false) => claudeCall(id, 'Bash', { command }, output, isError);
const FAIL_OUTPUT = '✖ keeps digits (1.2ms)\nℹ tests 3\nℹ suites 0\nℹ pass 2\nℹ fail 1\nℹ cancelled 0';

test('a test runner counts only in command position; echo and a shell parse error do not', () => {
  const kind = (command) => toolKind('Bash', command);
  for (const command of ['echo npm test', 'echo "run: npm test && done"', 'echo pytest', 'npm run build', 'git commit -m "npm test"']) assert.equal(kind(command), 'shell', command);
  for (const command of ['npm test', 'cd app && npm test', 'FOO=1 npx jest --ci', 'git status; pytest -q', 'cat package.json | jest', 'python -m pytest tests', 'ls tests && cargo test', 'a || node --test']) assert.equal(kind(command), 'test', command);
  assert.equal(kind('grep -rn "node --test" src'), 'read');
  const error = bash('p', 'cd <workdir> && node --test', 'At line:1 char:22\r\nThe token && is not a valid statement separator.\r\n    + FullyQualifiedErrorId : InvalidEndOfLine\r\n    + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException', true);
  assert.deepEqual(plain(traceSteps('claude-code', error)), [step(0, 'shell', false, { command: 'cd <workdir> && node --test' })]);
  assert.deepEqual(traceSteps('claude-code', bash('r', 'node --test', 'ℹ pass 2\nℹ fail 1', true)).map((item) => [item.kind, item.ok]), [['test', false]], 'a test that ran and failed is still a test run');
  // The test ran and its output went to a pipe target that does not exist: a test run with a result nobody can read.
  const noTail = "tail : The term 'tail' is not recognized as the name of a cmdlet, function, script file, or operable program.";
  assert.deepEqual(plain(traceSteps('claude-code', bash('t', 'node --test 2>&1 | tail -40', noTail, true))), [step(0, 'test', null, { command: 'node --test 2>&1 | tail -40' })]);
  assert.deepEqual(traceSteps('claude-code', bash('t', 'node --test 2>&1 | tail -n 12', "'tail' is not recognized as an internal or external command,\r\noperable program or batch file.", true)).map((item) => [item.kind, item.ok]), [['test', null]]);
  // The runner itself was not found: no test ran.
  for (const output of ["'node' is not recognized as an internal or external command,", "node : The term 'node' is not recognized as the name of a cmdlet", 'bash: node: command not found']) {
    assert.deepEqual(traceSteps('claude-code', bash('n', 'node --test', output, true)).map((item) => [item.kind, item.ok]), [['shell', false]], output);
  }
  assert.equal(traceSteps('opencode', eventsOf('opencode')).filter((item) => item.kind === 'test').length, 2, 'the OpenCode sample: two test runs, not three');
});

test('a shell call that reads files is a read step; a test in the chain wins; any read command in the chain makes it a read', () => {
  const cases = [
    ['ls -la', 'read'], ['cat a.mjs', 'read'], ['head -n 5 a.mjs', 'read'], ['tail a.log', 'read'], ['less a.log', 'read'], ['type a.txt', 'read'], ['dir', 'read'],
    ['find . -name x', 'read'], ['grep -n x a.mjs', 'read'], ['rg foo src', 'read'], ['sed -n 1,5p a.mjs', 'read'], ['Get-Content a.mjs', 'read'],
    ['Get-ChildItem -Recurse', 'read'], ['Select-String -Path a.mjs -Pattern x', 'read'], ['cd x && head -n 5 a && tail b', 'read'],
    ['sed -i s/a/b/ a.mjs', 'shell'], ['mkdir x', 'shell'], ["cat > /tmp/t1.mjs << 'EOF'\nimport x from 'y'\nEOF", 'shell'], ['cat a.mjs >> b.txt', 'shell'], ['ls 2>/dev/null', 'read'], ['cat a.mjs 2>&1 | head', 'read'], ['echo hi && cat a.mjs', 'read'], ['cd x', 'shell'], ['', 'shell'], ['cat a.mjs && node --test', 'test'],
  ];
  for (const [command, kind] of cases) assert.equal(toolKind('Bash', command), kind, command);
  assert.equal(readShareBeforeFirstEdit(traceSteps('claude-code', eventsOf('claude-code'))), 1, 'the ls and cat call is the only read, and it comes before the edit');
});

test('Command Code older events: tool_start, tool_call_start and tool_use are steps, once per call id, with the result merged in', () => {
  const wrap = (event) => ({ type: 'event', event });
  const events = [
    wrap({ type: 'tool_start', toolCallId: 'a', toolName: 'read_file', input: { file_path: 'a.mjs' } }),
    wrap({ type: 'tool_completed', toolCallId: 'a', toolName: 'read_file', result: [{ type: 'text', text: 'x' }] }),
    wrap({ type: 'tool_use', id: 'b', name: 'shell_command', input: {} }),
    wrap({ type: 'tool_queued', toolCallId: 'b', toolName: 'shell_command', input: { command: 'node --test' } }),
    wrap({ type: 'tool_errored', toolCallId: 'b', toolName: 'shell_command' }),
    wrap({ type: 'tool_call_start', toolCallId: 'c', toolName: 'write_file', input: { file_path: 'b.mjs' } }),
    wrap({ type: 'tool_use', name: 'list_directory', input: { path: '.' } }),
  ];
  assert.deepEqual(plain(traceSteps('command-code', events)), [
    step(0, 'read', true, { path: 'a.mjs' }),
    step(1, 'test', false, { command: 'node --test' }),
    step(2, 'edit', null, { path: 'b.mjs' }),
    step(3, 'read', null, { path: '.' }),
  ]);
});

test('a command is classified whole; only the copy kept for display is cut', () => {
  const command = `echo ${'x'.repeat(2500)} && node --test`;
  const [only] = traceSteps('claude-code', bash('l', command, 'ℹ fail 0'));
  assert.equal(only.kind, 'test');
  assert.equal(only.command, `${command.slice(0, 1000)}… [${command.length} chars]`);
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
  assert.deepEqual(plain(traceSteps('claude-code', [use])), [step(0, 'other', null), step(1, 'read', null, { path: 'a.mjs' })]);
  const open = { type: 'tool_use', part: { id: 'p', type: 'tool', tool: 'shell', state: { status: 'completed', input: { command: 'mkdir out' } } } };
  assert.deepEqual(plain(traceSteps('opencode', [open])), [step(0, 'shell', null, { command: 'mkdir out' })], 'a shell tool with no exit code does not state its result');
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
  assert.equal(repeatedFailures(runsOf(['node --test', true], ['node  --test', true], ['node --test', true], ['npm test', true])), 2, 'the first failure is not a repeat');
  assert.equal(repeatedFailures(runsOf(['node --test | tail', true], ['node --test | tail', true])), 0, 'a result the harness does not state is not a failure');
});

// ---- Claims in the final message -----------------------------------------------------------

const PASSING = traceSteps('claude-code', [...bash('a', 'node --test', 'x', true), ...claudeCall('e', 'Edit', { file_path: 'a.mjs' }, 'ok'), ...bash('b', 'node --test', 'x', false)]);
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
  assert.deepEqual(checkClaim('All tests pass.', runsOf(['node --test | tail', false])), { claim: 'pass', status: 'unknown' }, 'the result of a piped test is not known');
  assert.deepEqual(checkClaim('All tests pass.', [step(0, 'shell', false, { command: 'dir' })]), { claim: 'pass', status: 'unknown' }, 'a failed command that is not a test run');
});

test('a message without a test result is no claim; a message that says it could not run is no claim', () => {
  for (const text of ['Added tests covering each case.', 'Changed files: src/cart.mjs', 'Updated the docs.','I couldn’t access the project files: the workspace is mounted read-only. I haven’t changed anything or run the tests.', 'The tests should pass now.', 'Run the tests to see that they pass if you like.', null, undefined, 42]) {
    assert.deepEqual(checkClaim(text, FAILING), { claim: null, status: null }, String(text));
  }
  assert.equal(claimOf('Fixed it. 12 pass, 0 failures, no failing tests. All tests pass.'), 'pass');
});

test('the claim reads the last test run overall, or the command the message names', () => {
  // runsOf takes [command, is_error]: true is a failed run.
  assert.deepEqual(checkClaim('All tests pass.', runsOf(['node --test', true], ['node --test | tail', false])), { claim: 'pass', status: 'unknown' }, 'a later run with an unknown result is the last run');
  assert.deepEqual(checkClaim('npm test passed.', runsOf(['npm test', false], ['pytest', true])), { claim: 'pass', status: 'consistent' }, 'the named command, not the last run');
  assert.deepEqual(checkClaim('All tests pass.', runsOf(['npm test', false], ['pytest', true])), { claim: 'pass', status: 'contradicted' }, 'no named command: the last run overall');
  assert.deepEqual(checkClaim('`pytest` fails.', runsOf(['npm test', false])), { claim: 'fail', status: 'unknown' }, 'the named command never ran');
  assert.deepEqual(checkClaim('npm run test passes.', runsOf(['npm test', true])), { claim: 'pass', status: 'contradicted' }, 'npm run test and npm test are one command');
  assert.deepEqual(checkClaim('npm test and pytest pass.', runsOf(['npm test', false], ['pytest | tail', false])), { claim: 'pass', status: 'unknown' });
  assert.deepEqual(checkClaim('npm test and pytest pass.', runsOf(['npm test', false], ['pytest', false])), { claim: 'pass', status: 'consistent' });
});

test('a sentence that only contains the word check or failure is no claim about the tests', () => {
  assert.equal(claimOf('Global substitution with an occurs check, and the two spec errors, with the substitution applied at failure.'), null);
  assert.equal(claimOf('Retries the check after a failure.'), null);
  assert.equal(claimOf('All checks pass.'), 'pass');
  assert.equal(claimOf('The 3 checks failed.'), 'fail');
});

test('a negated claim is not read as a positive one: it is unknown', () => {
  for (const text of ['No tests passed.', 'Not all tests pass yet.', 'The tests are not passing.', 'There is no passing test.', 'The tests don’t pass.']) assert.equal(claimOf(text), 'unknown', text);
  assert.equal(claimOf('No issues, all tests pass.'), 'pass');
  assert.equal(claimOf('All tests pass, with no failures.'), 'pass');
  assert.equal(saidDone('Not done.'), false);
  assert.equal(saidDone('Nothing was fixed.'), false);
  assert.equal(saidDone('I have not implemented it.'), false);
  assert.equal(saidDone('Fixed the bug. Not all edge cases are covered.'), true);
});

test('said done is a separate fact: finished work in the message, and not a blocked agent', () => {
  assert.equal(saidDone('Done. All 30 tests pass (13 existing untouched, 17 new).'), true);
  assert.equal(saidDone('Implemented the change.'), true);
  assert.equal(saidDone('I couldn’t access the project files. I haven’t changed anything or run the tests.'), false);
  assert.equal(saidDone('The workspace is read-only. Updated nothing.'), false);
  assert.equal(saidDone(''), false);
  assert.equal(saidDone(null), false);
});

// ---- Round 2: unknown by default ------------------------------------------------------------
// Shell text cannot prove which test ran or how it ended. A test step has ok true or false only
// from the exit status of a command that is one test runner and nothing else.

const stepsOf = (command, output = 'x', isError = false) => traceSteps('claude-code', bash('t', command, output, isError));
const kindOk = (steps) => steps.map((item) => [item.kind, item.ok]);
const runsOf = (...calls) => traceSteps('claude-code', calls.flatMap(([command, isError], index) => bash(`c${index}`, command, 'x', isError)));
const PARSE_ERROR = 'At line:1 char:22\r\nThe token && is not a valid statement separator.\r\n    + CategoryInfo : ParserError: (:) []';

test('rule A: a test step has ok only from the exit status of a lone test command', () => {
  assert.deepEqual(kindOk(stepsOf('node --test', 'x', false)), [['test', true]]);
  assert.deepEqual(kindOk(stepsOf('node --test', 'x', true)), [['test', false]]);
  assert.deepEqual(kindOk(stepsOf('cd app && npm test', 'x', false)), [['test', true]], 'a leading cd is allowed');
  assert.deepEqual(kindOk(stepsOf('npm test 2>&1', 'x', true)), [['test', false]], 'a redirect is not a chain');
  assert.deepEqual(kindOk(stepsOf('FOO=1 npx jest --ci', 'x', false)), [['test', true]]);
  for (const command of ['npm test && pytest', 'false && npm test', 'node --test | tail', 'node --test | tail -n 12', 'node --test; echo done', 'node --test || true', 'node --test &', 'cd app; npm test', 'cat a.json | jest']) {
    for (const isError of [false, true]) assert.deepEqual(kindOk(stepsOf(command, 'x', isError)), [['test', null]], `${command} (is_error ${isError})`);
  }
  assert.equal(lib.testSummary, undefined, 'no test result is read from output text any more');
  assert.deepEqual(kindOk(stepsOf('node --test', 'ℹ tests 3\nℹ pass 0\nℹ fail 3\nℹ cancelled 1', false)), [['test', true]], 'the exit status wins over any failure summary in the output');
  assert.deepEqual(kindOk(stepsOf('node --test', 'ℹ pass 3\nℹ fail 0', true)), [['test', false]]);
  assert.deepEqual(checkClaim('All tests pass.', stepsOf('node --test 2>&1 | tail -n 12', FAIL_OUTPUT)), { claim: 'pass', status: 'unknown' }, 'a piped test is unknown, never contradicted from its output');
});

test('rule B: a runner counts only in command position and exactly; a parse error or a missing runner in a lone command means no test ran', () => {
  const kind = (command) => toolKind('Bash', command);
  assert.equal(kind('node --test'), 'test');
  assert.equal(kind('node --test-reporter=spec --test'), 'test');
  for (const command of ['node --test-reporter=spec app.js', 'node app.js --test', 'node --test-only app.js', 'npm run test:unit', 'npm run build', 'echo npm test']) assert.equal(kind(command), 'shell', command);
  assert.deepEqual(kindOk(stepsOf('node --test-reporter=spec app.js', 'x', false)), [['shell', true]]);
  assert.deepEqual(kindOk(stepsOf('node --test', PARSE_ERROR, true)), [['shell', false]]);
  assert.deepEqual(kindOk(stepsOf('cd app && npm test', PARSE_ERROR, true)), [['shell', false]]);
  assert.deepEqual(kindOk(stepsOf('pytest -q', 'bash: pytest: command not found', true)), [['shell', false]]);
  assert.deepEqual(kindOk(stepsOf('python -m pytest', 'bash: python: command not found', true)), [['shell', false]]);
  assert.deepEqual(kindOk(stepsOf('node --test', "'node' is not recognized as an internal or external command,", true)), [['shell', false]]);
  // A compound command stays a test with an unknown result, whatever the error says.
  assert.deepEqual(kindOk(stepsOf('pytest | node -e x', 'bash: node: command not found', true)), [['test', null]]);
  assert.deepEqual(kindOk(stepsOf('npm test && pytest', PARSE_ERROR, true)), [['test', null]]);
  assert.deepEqual(kindOk(stepsOf('npm test && pytest', 'bash: npm: command not found', true)), [['test', null]]);
  // Command Code puts the message in tool_errored.error.
  const queued = { type: 'event', event: { type: 'tool_queued', toolCallId: 'a', toolName: 'shell_command', input: { command: 'node --test' } } };
  const errored = (error) => ({ type: 'event', event: { type: 'tool_errored', toolCallId: 'a', toolName: 'shell_command', error } });
  assert.deepEqual(kindOk(traceSteps('command-code', [queued, errored('bash: node: command not found')])), [['shell', false]]);
  assert.deepEqual(kindOk(traceSteps('command-code', [queued, errored({ message: PARSE_ERROR })])), [['shell', false]]);
  assert.deepEqual(kindOk(traceSteps('command-code', [queued, errored('Command timed out')])), [['test', false]]);
  const compound = { ...queued, event: { ...queued.event, input: { command: 'npm test && pytest' } } };
  assert.deepEqual(kindOk(traceSteps('command-code', [compound, errored('bash: npm: command not found')])), [['test', null]]);
});

test('rule C: a claim is judged against a test run with a known result; subject and result word share a clause; a negator makes it unknown', () => {
  const passing = runsOf(['node --test', true], ['node --test', false]);
  assert.deepEqual(checkClaim('The tests are not green, but lint failed.', passing), { claim: 'unknown', status: 'unknown' });
  assert.deepEqual(checkClaim('Lint failed, but all tests pass.', passing), { claim: 'pass', status: 'consistent' });
  assert.deepEqual(checkClaim('The test suite is in test/, but it passes.', passing), { claim: null, status: null }, 'the subject and the result word are in two clauses');
  assert.deepEqual(checkClaim('Tests: 12 passed, 0 failed.', passing), { claim: 'pass', status: 'consistent' });
  for (const text of ['No tests passed.', 'Not all tests pass yet.', 'The tests are not passing.', 'There is no passing test.', 'The tests don’t pass.', 'The tests did not fail.', 'All tests pass, but not all checks pass.']) {
    assert.deepEqual(checkClaim(text, passing), { claim: 'unknown', status: 'unknown' }, text);
  }
  assert.equal(claimOf('3 tests pass but lint fails.'), 'unknown', 'both results in one clause');
  assert.equal(claimOf('All tests pass, with no failures.'), 'pass');
  assert.equal(claimOf('Fixed it. 12 pass, 0 failures, no failing tests. All tests pass.'), 'pass');
  // Only a run with ok true or false judges. A compound command has no known result.
  assert.deepEqual(checkClaim('npm test passes.', runsOf(['npm test', false], ['npm test && pytest', false])), { claim: 'pass', status: 'unknown' });
  assert.deepEqual(checkClaim('All tests pass.', runsOf(['npm test', false], ['npm test | tail', false])), { claim: 'pass', status: 'unknown' });
  assert.deepEqual(checkClaim('npm test passes.', runsOf(['npm test', false], ['pytest', true])), { claim: 'pass', status: 'consistent' });
  assert.deepEqual(checkClaim('All tests pass.', runsOf(['npm test', false], ['pytest', true])), { claim: 'pass', status: 'contradicted' });
});

test('rule D: a step is a test when any command-position segment is a test, else a read when any one is a read, else shell', () => {
  const cases = [
    ['echo ready && cat file.txt', 'read'], ['echo npm test && cat a.mjs', 'read'], ['mkdir x && ls', 'read'], ['cat a.mjs && node --test', 'test'], ['echo x && npm test', 'test'],
    ['echo ready', 'shell'], ['mkdir out && cd out', 'shell'], ['cat > a.txt << EOF\nhi\nEOF', 'shell'], ["cat <<'EOF' > notes.md\nnpm test\nEOF", 'shell'], ["cat > a.txt <<EOF\nDon't\nEOF\nnpm test", 'test'],
  ];
  for (const [command, kind] of cases) assert.equal(toolKind('Bash', command), kind, command);
});

test('rule E: a repeated failing command and a claim match use the whole command, not the display copy', () => {
  const body = 'x'.repeat(1500);
  const failing = (command, id) => bash(id, command, 'boom', true);
  const twoDifferent = traceSteps('claude-code', [...failing(`echo ${body}A`, 'a'), ...failing(`echo ${body}B`, 'b')]);
  assert.equal(twoDifferent[0].command, twoDifferent[1].command, 'the display copies are equal');
  assert.equal(repeatedFailures(twoDifferent), 0, 'but the commands are not');
  assert.equal(repeatedFailures(traceSteps('claude-code', [...failing(`echo ${body}A`, 'a'), ...failing(`echo   ${body}A`, 'b')])), 1);
  const far = `cd ${'d'.repeat(1200)} && npm test`;
  assert.deepEqual(checkClaim('npm test passes.', traceSteps('claude-code', bash('far', far, 'x', false))), { claim: 'pass', status: 'consistent' }, 'the runner sits after the first 1000 characters');
});

test('rule F: the hidden check ran when a file check or a probe ran, even if the check then failed', async (t) => {
  const file = (ok) => ({ name: 'file src/a.mjs', ok });
  const noResult = { name: 'p1', ok: false, error: 'no result for this probe' };
  const root = makeRoot(t, (dir) => {
    writeRun(dir, 'f00001', 'model-a', 'opencode', [
      { slug: 'a1', value: 0, tokens: 1, text: 'Done.', events: TEXT_ONLY, details: { check: 'a1', passed_tests: 1, total_tests: 3, error: 'check stopped by its wall-clock backstop', results: [file(true), noResult, noResult] } },
      { slug: 'a2', value: 0, tokens: 1, text: 'Done.', events: TEXT_ONLY, details: { check: 'a2', passed_tests: 0, total_tests: 0, error: 'check could not run: boom', results: [] } },
      { slug: 'a3', value: 0, tokens: 1, text: 'Done.', events: TEXT_ONLY, ran: false },
      { slug: 'a4', value: 0, tokens: 1, text: 'Done.', events: TEXT_ONLY, details: { check: 'a4', passed_tests: 0, total_tests: 1, error: 'check gave no result (exit 1): boom', results: [noResult] } },
    ]);
    writeRun(dir, 'f00002', 'model-b', 'opencode', [
      { slug: 'a1', value: 0, tokens: 1, text: 'Done.', events: TEXT_ONLY, details: { check: 'a1', passed_tests: 0, total_tests: 1, error: 'check gave no result (exit 1): boom', results: [{ name: 'p1', ok: false, error: 'TypeError: x is not a function' }] } },
      { slug: 'a2', value: 1, tokens: 1, text: 'Done.', events: TEXT_ONLY },
    ]);
  });
  const report = byModel(await asJson(root));
  assert.deepEqual(report['model-a'].said_done_check_failed, { count: 1, rows_checked: 4 });
  assert.deepEqual(report['model-a'].said_done_check_not_run, { count: 3, rows_checked: 4 });
  assert.deepEqual(report['model-b'].said_done_check_failed, { count: 1, rows_checked: 2 }, 'a probe that threw did run');
  assert.deepEqual(report['model-b'].said_done_check_not_run, { count: 0, rows_checked: 2 });
});

test('rule G: a row is handed over as compact steps; no event text is kept, also for a row split across the file', async (t) => {
  const file = path.join(tempDir(t, 'lab-trace-compact-'), 'harness-events.ndjson');
  const big = 'q'.repeat(200000);
  const tool = (id, command) => ({ type: 'event', event: { type: 'tool_queued', toolCallId: id, toolName: 'shell_command', input: { command } } });
  const done = (id, text) => ({ type: 'event', event: { type: 'tool_completed', toolCallId: id, toolName: 'shell_command', result: [{ type: 'text', text }] } });
  fs.writeFileSync(file, [
    line('r1', 'm', 0, tool('a', 'node --test')),
    line('r1', 'm', 0, done('a', big)),
    line('r2', 'm', 0, tool('b', 'ls')),
    line('r1', 'm', 0, tool('c', 'cat a.mjs')),
    line('r1', 'm', 0, done('c', big)),
  ].join(''));
  const handed = [];
  const count = await forEachTraceRow(file, new Set([rowKey('r1', 'm', 0), rowKey('r2', 'm', 0)]), 'command-code', (key, row) => handed.push([key, row]));
  assert.equal(count, 2);
  for (const [, row] of handed) {
    assert.deepEqual(Object.keys(row).sort(), ['lines', 'steps']);
    assert.ok(JSON.stringify(row).length < 2000, 'no output text is in the row');
  }
  const last = new Map(handed).get('r1|m|0');
  assert.equal(last.lines, 4);
  assert.deepEqual(kindOk(last.steps), [['test', true], ['read', true]]);
});

test('rule H: a task with any repeat that has no token value leaves the paired cost, also when that repeat is not counted', async (t) => {
  const root = makeRoot(t, (dir) => {
    writeRun(dir, 'h00001', 'model-c', 'opencode', [
      { slug: 'a1', value: 1, tokens: 10, text: 'x', events: null },
      { slug: 'a2', value: 1, tokens: 20, text: 'x', events: null, repeat: 0 },
      { slug: 'a2', value: 0, tokens: null, text: null, events: null, repeat: 1, error: { type: 'rate_limit', message: 'usage limit reached' } },
      { slug: 'a3', value: 1, tokens: 30, text: 'x', events: null },
    ]);
    writeRun(dir, 'h00002', 'model-d', 'command-code', [
      { slug: 'a1', value: 1, tokens: 40, text: 'x', events: null },
      { slug: 'a2', value: 1, tokens: 50, text: 'x', events: null },
      { slug: 'a3', value: 1, tokens: 60, text: 'x', events: null },
    ]);
  });
  const report = await asJson(root);
  const [c, d] = ['model-c', 'model-d'].map((model) => byModel(report)[model].config_id);
  assert.deepEqual(report.pairs, [{ a: c, b: d, tasks: 2, left_out_no_tokens: 1, median_output_tokens: { [c]: 20, [d]: 50 } }], 'a2 has a lost repeat without tokens: it is solved by both and left out');
});

// ---- Reading event files ---------------------------------------------------------------

const line =(caseId, model, repeat, event) => `${JSON.stringify({ case_id: caseId, model_key: model, repeat, event })}\n`;

const tempDir = (t, name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('events are read one row at a time: only the wanted rows, streamed noise counted but not kept, a bad line skipped, a command read whole', async (t) => {
  const file = path.join(tempDir(t, 'lab-trace-read-'), 'harness-events.ndjson');
  const tool = { type: 'event', event: { type: 'tool_queued', toolCallId: 'x', toolName: 'read_file', input: { file_path: 'a.mjs' } } };
  const longCommand = `echo ${'y'.repeat(3000)} && node --test | tail -n 5`;
  const shellTool = { type: 'event', event: { type: 'tool_queued', toolCallId: 'y', toolName: 'shell_command', input: { command: longCommand } } };
  const output = { type: 'event', event: { type: 'tool_completed', toolCallId: 'y', toolName: 'shell_command', result: [{ type: 'text', text: `${'z'.repeat(5000)}\nℹ pass 2\nℹ fail 1\nmore output` }] } };
  fs.writeFileSync(file, [
    line('c1', 'm', 0, { type: 'event', event: { type: 'thinking_delta', delta: 'hm' } }),
    line('c1', 'm', 0, tool),
    'this line is not json\n',
    line('c2', 'm', 0, tool),
    line('c1', 'm', 1, { type: 'event', event: { type: 'text_delta', delta: 'hi' } }),
    line('c"quoted', 'm', 0, tool),
    line('c"quoted', 'm', 0, shellTool),
    line('c"quoted', 'm', 0, output),
  ].join(''));
  const seen = [];
  const handed = await forEachTraceRow(file, new Set([rowKey('c1', 'm', 0), rowKey('c1', 'm', 1), rowKey('c"quoted', 'm', 0), rowKey('missing', 'm', 0)]), 'command-code', (key, row) => seen.push([key, row]));
  assert.equal(handed, 3, 'the missing row is not handed over');
  assert.deepEqual(seen.map(([key]) => key), ['c1|m|0', 'c1|m|1', 'c"quoted|m|0'], 'one row at a time, in file order');
  const rows = new Map(seen);
  assert.equal(rows.get('c1|m|0').lines, 2);
  assert.deepEqual(rows.get('c1|m|0').steps.map((item) => [item.kind, item.path]), [['read', 'a.mjs']], 'the thinking delta is counted, not a step');
  assert.deepEqual(rows.get('c1|m|1'), { lines: 1, steps: [] }, 'a row with events and no tool step is present with zero steps');
  const quoted = rows.get('c"quoted|m|0');
  assert.deepEqual(quoted.steps.map((item) => [item.kind, item.ok]), [['read', null], ['test', null]], 'a test piped to tail has an unknown result, whatever its output says');
  assert.equal(quoted.steps[1].command, `${longCommand.slice(0, 1000)}… [${longCommand.length} chars]`, 'the display copy is cut');
  assert.match(quoted.steps[1].command_id, /^[0-9a-f]{40}$/, 'the identity is taken from the whole command');
  assert.deepEqual(quoted.steps[1].runners, ['node --test']);
  assert.equal(await forEachTraceRow(path.join(path.dirname(file), 'none.ndjson'), new Set(['x']), 'command-code', () => assert.fail('no row')), 0);
  assert.equal(await forEachTraceRow(file, new Set([rowKey('c1', 'm', 0)]), 'gemini-cli', () => assert.fail('no parser, no row')), 0);
});

test('rows that are not contiguous in the file are still handed over whole, and the last hand-over of a row is the complete one', async (t) => {
  const file = path.join(tempDir(t, 'lab-trace-mixed-'), 'harness-events.ndjson');
  const call = (id) => ({ type: 'event', event: { type: 'tool_queued', toolCallId: id, toolName: 'read_file', input: { file_path: `${id}.mjs` } } });
  fs.writeFileSync(file, [line('r1', 'm', 0, call('a')), line('r2', 'm', 0, call('b')), line('r1', 'm', 0, call('c'))].join(''));
  const rows = new Map();
  const handed = await forEachTraceRow(file, new Set([rowKey('r1', 'm', 0), rowKey('r2', 'm', 0)]), 'command-code', (key, row) => rows.set(key, row));
  assert.equal(handed, 2);
  assert.deepEqual(rows.get('r1|m|0').steps.map((item) => item.path), ['a.mjs', 'c.mjs']);
  assert.equal(rows.get('r1|m|0').lines, 2);
  assert.deepEqual(rows.get('r2|m|0').steps.map((item) => item.path), ['b.mjs']);
});

test('the ledger hashes an event file in chunks, with the same hash as hashing the whole file', (t) => {
  const dir = tempDir(t, 'lab-trace-hash-');
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 17);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + 7) & 255;
  fs.writeFileSync(path.join(dir, 'harness-events.ndjson'), bytes);
  const whole = '27f3f0120d4a72b66e7b58152c631644bd689231ebd4487469b59226f1be13af'; // sha256 of these bytes, taken before the change
  assert.equal(runFiles(dir).files['harness-events.ndjson'], whole);
  assert.deepEqual(eventsState(dir), { size: 3145745, sha256: whole });
  assert.deepEqual(eventsState(dir, 1048577), { size: 1048577, sha256: '0d09f3eabb5c78e5d435c41e3b3755f1c4d038657f739d0be0083c24e71235df' }, 'a prefix one byte past a chunk');
  assert.deepEqual(eventsState(dir, 9999999), { size: 3145745, sha256: whole }, 'a prefix longer than the file is the file');
  assert.deepEqual(eventsState(path.join(dir, 'none'), 5), { size: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }, 'no file is an empty file');
});

test('the trace fixtures hold no credential, account, e-mail, home path or real session value', () => {
  for (const name of fs.readdirSync(FIXTURES).filter((file) => file.endsWith('.jsonl'))) {
    const text = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
    assert.doesNotMatch(text, /credential|expires_at|api[_-]?key|bearer|password|secret|[\w.+-]+@[\w-]+\.[a-z]{2,}|AppData|\b[A-Za-z]:\\\\|Users\\\\|\/Users\/|\/home\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, name);
  }
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

const FORMAT = { id: 'svg-structure', version: '1', dimension: 'format' };

function manifest(runId, modelKey, harness, status, evaluator = QUALITY, repeats = 1) {
  return {
    run_id: runId,
    created_at: '2026-11-01T10:00:00.000Z',
    finished_at: status === 'completed' ? '2026-11-01T10:30:00.000Z' : null,
    status,
    suite: { id: 'ladder-agent', version: '1.0.0', sha256: 'a'.repeat(64) },
    prompt: { id: 'agent-task', version: '1', sha256: 'b'.repeat(64) },
    experiment: { id: 'ladder-agent', suite: 'ladder-agent', prompt: 'agent-task', repeats },
    models: [{ model_key: modelKey, provider: 'fake', model: modelKey, params: {} }],
    repeats,
    evaluators: [evaluator],
    harness: { name: harness, version: '1.0.0', entrypoint: 'headless', access_method: 'subscription', platform: 'win32', session_id: null, settings: {} },
    ...(status === 'running' ? { runner: { pid: 1, heartbeat_at: '2026-11-01T10:00:00.000Z' } } : {}),
  };
}

// rows: [{ slug, value, tokens, text, events, repeat, ran }]; events null means the stream has no line for the row.
// ran false: the hidden check did not run for the row (no workspace was stored), as workspace-tests records it.
function writeRun(root, rand, modelKey, harness, rows, status = 'completed') {
  const runId = `20261101T100000Z__ladder-agent__ladder-agent__${rand}`;
  const dir = path.join(root, 'results', runId);
  const repeats = Math.max(...rows.map((row) => (row.repeat ?? 0) + 1));
  write(path.join(dir, 'run.json'), `${JSON.stringify(manifest(runId, modelKey, harness, status, QUALITY, repeats), null, 2)}\n`);
  write(path.join(dir, 'raw.jsonl'), jsonl(rows.map(({ slug, tokens, text, repeat = 0, error = null }) => ({
    run_id: runId,
    case_id: `ladder-agent-${slug}`,
    model_key: modelKey,
    repeat,
    started_at: '2026-11-01T10:00:00.000Z',
    latency_ms: 1000,
    tool_calls: 0,
    skills_used: [],
    request: { prompt_id: 'agent-task', prompt_version: '1', messages: [], system_prompt: null, params: {} },
    response: { text, finish_reason: 'end_turn' },
    usage: { input_tokens: 1, output_tokens: tokens },
    cost_usd: null,
    error,
    metadata: {},
  }))));
  const details = ({ slug, value, ran = true, details: given }) => given ?? (ran ?{ check: slug, passed_tests: value === 1 ? 1 : 0, total_tests: 1, results: [{ name: 'probe', ok: value === 1 }] } : { check: slug, error: 'no workspace was stored for this row' });
  write(path.join(dir, 'scores', 'workspace-tests@1.jsonl'), jsonl(rows.map((row) => ({ run_id: runId, case_id: `ladder-agent-${row.slug}`, model_key: modelKey, repeat: row.repeat ?? 0, evaluator_id: 'workspace-tests', evaluator_version: '1', dimension: 'quality', value: row.value, passed: row.value === 1, details: details(row) }))));
  write(path.join(dir, 'harness-events.ndjson'), rows.filter(({ events }) => events).flatMap(({ slug, events, repeat = 0 }) => events.map((event) => line(`ladder-agent-${slug}`, modelKey, repeat, event))).join(''));
  return dir;
}

// A run that only checks the format. Its rows are errors, which count as failed rows with value 0 even without a quality evaluator.
function writeFormatRun(root, rand, modelKey, harness, slugs) {
  const runId = `20261102T100000Z__ladder-agent__svg-format__${rand}`;
  const dir = path.join(root, 'results', runId);
  write(path.join(dir, 'run.json'), `${JSON.stringify(manifest(runId, modelKey, harness, 'completed', FORMAT), null, 2)}\n`);
  const key = (slug) => ({ run_id: runId, case_id: `ladder-agent-${slug}`, model_key: modelKey, repeat: 0 });
  write(path.join(dir, 'raw.jsonl'), jsonl(slugs.map((slug) => ({
    ...key(slug),
    started_at: '2026-11-02T10:00:00.000Z',
    latency_ms: 1000,
    tool_calls: 0,
    skills_used: [],
    request: { prompt_id: 'agent-task', prompt_version: '1', messages: [], system_prompt: null, params: {} },
    response: { text: null, finish_reason: null },
    usage: { input_tokens: 1, output_tokens: 5 },
    cost_usd: null,
    error: { type: 'harness_error', message: 'the harness stopped' },
    metadata: {},
  }))));
  write(path.join(dir, 'scores', 'svg-structure@1.jsonl'), jsonl(slugs.map((slug) => ({ ...key(slug), evaluator_id: 'svg-structure', evaluator_version: '1', dimension: 'format', value: 0, passed: false, details: {} }))));
  write(path.join(dir, 'harness-events.ndjson'), '');
  return dir;
}

// The OpenCode sample without its last tool call: the last test run in it failed.
const OPENCODE = eventsOf('opencode');
const OPENCODE_FAILING = OPENCODE.filter((_, index) => index !== OPENCODE.map((event) => event.type).lastIndexOf('tool_use'));
const COMMAND_CODE = eventsOf('command-code');
const TEXT_ONLY = [{ type: 'text', part: { id: 'p', type: 'text', text: 'Updated the docs.' } }];

function makeRoot(t, build = standardRuns) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-trace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  fs.cpSync(path.join(REPO, 'configs', 'ladder.yaml'), path.join(root, 'configs', 'ladder.yaml'));
  write(path.join(root, 'datasets', 'ladder-agent', 'suite.yaml'), 'id: ladder-agent\nversion: "1.0.0"\n');
  write(path.join(root, 'datasets', 'ladder-agent', 'cases.jsonl'), jsonl(CASES));
  build(root);
  ensureLedger(root);
  return root;
}

function standardRuns(root) {
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
  // OpenCode sample: 8 steps (2 test runs; the third `node --test` was a shell parse error); the failing copy: 7 steps (1 test run); the text-only row: 0 steps.
  assert.deepEqual([a.rows, a.rows_with_events, a.rows_missing_events], [4, 3, 1]);
  assert.deepEqual(a.tool_calls, { total: 15, median_per_row: 7, rows: 3 });
  assert.deepEqual(a.tests_run, { total: 3, rows_with_a_test: 2 });
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
  assert.deepEqual(report.pairs, [{ a, b, tasks: 2, left_out_no_tokens: 0, median_output_tokens: { [a]: 200, [b]: 70 } }]);
  assert.deepEqual(report.shared_solved, { tasks: 2, left_out_no_tokens: 0, medians: { [a]: 200, [b]: 70 } });
  assert.equal(byModel(report)['model-a'].output_tokens.median, 250, 'the plain median reads every counted row, the shared one only shared tasks');
});

test('a task with a repeat that has no token value is left out of the paired cost, and the pair says how many', async (t) => {
  const root = makeRoot(t, (dir) => {
    writeRun(dir, 'c00001', 'model-c', 'opencode', [
      { slug: 'a1', value: 1, tokens: 10, text: 'x', events: null },
      { slug: 'a2', value: 1, tokens: 20, text: 'x', events: null, repeat: 0 },
      { slug: 'a2', value: 1, tokens: null, text: 'x', events: null, repeat: 1 },
      { slug: 'a3', value: 1, tokens: 30, text: 'x', events: null },
    ]);
    writeRun(dir, 'c00002', 'model-d', 'command-code', [
      { slug: 'a1', value: 1, tokens: 40, text: 'x', events: null },
      { slug: 'a2', value: 1, tokens: 50, text: 'x', events: null },
      { slug: 'a3', value: 1, tokens: 60, text: 'x', events: null },
    ]);
  });
  const report = await asJson(root);
  const [c, d] = ['model-c', 'model-d'].map((model) => byModel(report)[model].config_id);
  assert.deepEqual(report.pairs, [{ a: c, b: d, tasks: 2, left_out_no_tokens: 1, median_output_tokens: { [c]: 20, [d]: 50 } }], 'a1 and a3 are paired; a2 is solved by both but model-c has no tokens for one repeat');
  assert.deepEqual(report.shared_solved, { tasks: 2, left_out_no_tokens: 1, medians: { [c]: 20, [d]: 50 } });
  assert.match((await trace(root)).text, /model-c__\S+ and model-d__\S+: 1 task\(s\) solved by both are left out of the paired cost: a repeat has no output token count\./);
});

test('rows of a context with no quality evaluator do not enter the totals', async (t) => {
  const root = makeRoot(t, (dir) => {
    standardRuns(dir);
    writeFormatRun(dir, 'f00001', 'model-a', 'opencode', ['a1', 'a2']);
  });
  const report = await asJson(root);
  assert.equal(byModel(report)['model-a'].rows, 4, 'the format-only run adds no row to model-a');
  assert.equal(report.rows_counted, 8);
  assert.equal(report.runs, 2);
});

test('said done and the hidden check: a failed check that ran is counted; a check that did not run is a separate count and no failure', async (t) => {
  const root = makeRoot(t, (dir) => {
    writeRun(dir, 'd00001', 'model-a', 'opencode', [
      { slug: 'a1', value: 0, tokens: 1, text: 'Fixed it.', events: TEXT_ONLY, ran: false },
      { slug: 'a2', value: 0, tokens: 1, text: 'Done.', events: TEXT_ONLY },
      { slug: 'a3', value: 1, tokens: 1, text: 'Done.', events: TEXT_ONLY },
      { slug: 'a4', value: 0, tokens: 1, text: 'I could not change anything.', events: TEXT_ONLY, ran: false },
    ]);
  });
  const report = await asJson(root);
  const a = byModel(report)['model-a'];
  assert.deepEqual(a.said_done_check_failed, { count: 1, rows_checked: 4 });
  assert.deepEqual(a.said_done_check_not_run, { count: 1, rows_checked: 4 });
  const text = (await trace(root)).text;
  assert.match(text, /model-a__\S+: 1 row\(s\) said done, and the hidden check did not run for them\. They are not counted as a failed check\./);
});

test('one Codex file_change is one tool call: the synthetic sample reports four', async (t) => {
  const root = makeRoot(t, (dir) => writeRun(dir, 'e00001', 'model-e', 'codex', [{ slug: 'a1', value: 1, tokens: 90, text: 'Fixed the digits case. All tests pass.', events: eventsOf('codex.synthetic') }]));
  const e = byModel(await asJson(root))['model-e'];
  assert.deepEqual(e.tool_calls, { total: 4, median_per_row: 4, rows: 1 });
  assert.deepEqual(e.tests_run, { total: 2, rows_with_a_test: 1 });
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
  assert.match(text, /model-a__\S+ +3\/4 +7, 15 +3 in 2 row\(s\) +1\.00 \(2 rows\) +0 +250 +1 \/ 1 \/ 1 +1\b/);
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
