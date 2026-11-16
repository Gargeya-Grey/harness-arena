// Adapter parsers on real recorded harness output (tests/fixtures/harness/).
// The expected usage is what the smoke runs stored in raw.jsonl.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, getAdapter } from '../lab/adapters/index.mjs';
import { flattenMessages, stderrError } from '../lab/adapters/process.mjs';
import { defineCli, withExtra } from '../lab/adapters/cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(here, 'fixtures', 'harness', name), 'utf8');

test('claude-code: parses the stream-json result', () => {
  const out = getAdapter('claude-code').parse({ stdout: fixture('claude-code.stdout.jsonl'), stderr: '', code: 0 });
  assert.equal(out.error, null);
  assert.equal(out.text, '4');
  assert.deepEqual(out.usage, { input_tokens: 38029, output_tokens: 3, cache_read_tokens: 16672, cache_write_tokens: 21355 });
  assert.equal(out.tool_calls, 0);
});

test('codex: parses the agent message and turn usage', () => {
  const out = getAdapter('codex').parse({ stdout: fixture('codex.stdout.jsonl'), stderr: '', code: 0 });
  assert.equal(out.error, null);
  assert.equal(out.text, '4');
  assert.deepEqual(out.usage, { input_tokens: 26844, output_tokens: 5, cache_read_tokens: 12672, cache_write_tokens: 0 });
});

test('command-code: parses the result line', () => {
  const out = getAdapter('command-code').parse({ stdout: fixture('command-code.stdout.jsonl'), stderr: '', code: 0 });
  assert.equal(out.error, null);
  assert.equal(out.text, '4');
  assert.deepEqual(out.usage, { input_tokens: 18488, output_tokens: 64, cache_read_tokens: 0, cache_write_tokens: 0 });
});

// A real Command Code 1.88.5 agent stream (text, thinking and trace events removed, paths replaced). Each of
// its 8 tool calls sends tool_queued, tool_running and tool_completed (one ends in tool_errored instead).
test('command-code 1.88: counts each tool call once, by its id', () => {
  const stdout = fixture('command-code-1.88.stdout.jsonl');
  const out = getAdapter('command-code').parse({ stdout, stderr: '', code: 0 });
  assert.equal(out.error, null);
  assert.match(out.text, /^All 3 tests pass\./);
  assert.equal(out.tool_calls, 8);
  assert.equal(out.turn_count, 6);
  assert.equal(out.model_reported, 'deepseek/deepseek-v4.1-flash');
  assert.equal(out.effort_reported, 'max');
  // A tool_use with the same id as a queued call (a streamed content block) is not a second call.
  const first = JSON.parse(stdout.split('\n').find((line) => line.includes('"tool_queued"')));
  const repeat = JSON.stringify({ type: 'event', event: { type: 'tool_use', id: first.event.toolCallId, name: first.event.toolName } });
  assert.equal(getAdapter('command-code').parse({ stdout: `${repeat}\n${stdout}`, stderr: '', code: 0 }).tool_calls, 8);
});

test('gemini-cli: parses JSON after a log line; thinking counts as output', () => {
  const out = getAdapter('gemini-cli').parse({ stdout: fixture('gemini-cli.synthetic.stdout.txt'), stderr: '', code: 0 });
  assert.equal(out.error, null);
  assert.equal(out.text, '4');
  assert.deepEqual(out.usage, { input_tokens: 9120, output_tokens: 30, cache_read_tokens: 4000, cache_write_tokens: 0 });
  assert.equal(out.model_request_duration_ms, 812);
});

test('gemini-cli: a refused sign-in is an auth error with the real message', () => {
  const out = getAdapter('gemini-cli').parse({ stdout: '', stderr: fixture('gemini-cli.auth-error.stderr.txt'), code: 1 });
  assert.equal(out.text, null);
  assert.equal(out.error.type, 'auth');
  assert.match(out.error.message, /IneligibleTierError/);
});

test('every CLI adapter reports empty output as an error, not as an answer', () => {
  for (const adapter of Object.values(ADAPTERS).filter((item) => item.kind === 'cli')) {
    const out = adapter.parse({ stdout: '', stderr: '', code: 1 });
    assert.ok(out.error, adapter.name);
    assert.equal(out.text, null, adapter.name);
  }
});

test('stderrError: finds the first error line and skips stack noise', () => {
  assert.deepEqual(stderrError('warn\nError: boom\n    at x\n}'), { type: 'harness_error', message: 'Error: boom' });
  assert.equal(stderrError('Error: Not logged in. Run login first').type, 'auth');
  assert.equal(stderrError('}\n'), null);
});

test('flattenMessages: one user message, system text first', () => {
  const flat = flattenMessages([
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Q?' },
  ]);
  assert.match(flat.prompt, /Be brief\.[\s\S]*Q\?/);
  assert.throws(() => flattenMessages([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]));
});

test('CLI args never pass the prompt through a shell and pin the model', () => {
  const claude = getAdapter('claude-code').args({ model: 'claude-haiku-5-5', effort: 'low' });
  assert.ok(claude.includes('--model') && claude.includes('claude-haiku-5-5'));
  assert.ok(claude.includes('--no-session-persistence'));
  const codex = getAdapter('codex').args({ model: 'gpt-6-luna', effort: 'low', cwd: '/tmp/x' });
  assert.ok(codex.includes('read-only'), 'codex runs in a read-only sandbox');
});

test('codex: edit calls keep workspace access and the installed sandbox configuration', () => {
  const adapter = getAdapter('codex');
  const args = withExtra(adapter.args({ model: 'gpt-6.1-terra', effort: 'high', access: 'edit' }), adapter.edit.args);
  assert.equal(args[args.indexOf('-s') + 1], 'workspace-write');
  assert.ok(!args.includes('read-only'));
  assert.ok(!args.includes('danger-full-access'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!args.some((arg) => arg.startsWith('windows.sandbox=')), 'the owner chooses the installed sandbox backend');
  const answer = adapter.args({ model: 'gpt-6.1-terra', access: 'answer' });
  assert.equal(answer[answer.indexOf('-s') + 1], 'read-only');
  assert.ok(!answer.some((arg) => arg.startsWith('windows.sandbox=')), 'answer calls do not receive the edit backend override');
});

test('codex: isolated Windows edit calls refuse repeated sandbox setup before a model is called', () => {
  const adapter = getAdapter('codex');
  const input = { model: 'gpt-6.1-terra', access: 'edit', tempHome: 'C:/task-owned-temporary-home' };
  if (process.platform === 'win32') assert.throws(() => adapter.args(input), /repeated Windows approval[\s\S]*user_config: loaded[\s\S]*No model call/);
  else assert.doesNotThrow(() => adapter.args(input));
  assert.doesNotThrow(() => adapter.args({ ...input, tempHome: null }));
});

test('codex: Windows isolation removes personal memory and skills while retaining the installed home', (t) => {
  if (process.platform !== 'win32') return t.skip('native Windows configuration');
  const adapter = getAdapter('codex');
  assert.equal(adapter.isolation.home, null);
  assert.ok(adapter.isolation.flags.includes('--ignore-user-config'));
  assert.ok(adapter.isolation.flags.includes('--ignore-rules'));
  assert.ok(adapter.isolation.flags.includes('skills.include_instructions=false'));
  for (const feature of ['memories', 'plugins', 'apps', 'hooks', 'skill_search']) {
    assert.ok(adapter.isolation.flags.includes(`features.${feature}=false`), feature);
  }
  assert.ok(adapter.isolation.args.includes('--no-daemon'));
  assert.match(adapter.isolation.note, /global AGENTS\.md.*still loads/);
  assert.match(adapter.isolation.note, /partly kept out/);
  assert.ok(adapter.isolation.clearEnv.includes('CODEX_THREAD_ID'));
});

test('codex: Windows isolated edits reapply only the verified installed backend and refuse missing setup', (t) => {
  if (process.platform !== 'win32') return t.skip('native Windows configuration');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-codex-backend-test-'));
  t.after(() => {
    assert.equal(path.dirname(home), fs.realpathSync(os.tmpdir()));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const adapter = getAdapter('codex');
  const input = { model: 'gpt-6.1-terra', access: 'edit', isolated: true, env: { CODEX_HOME: home } };
  assert.throws(() => adapter.args(input), /existing config.toml[\s\S]*No model call/);
  fs.writeFileSync(path.join(home, 'config.toml'), '[windows]\nsandbox = "elevated"\n');
  assert.throws(() => adapter.args(input), /already initialized elevated sandbox[\s\S]*No model call/);
  for (const rel of ['.sandbox/setup_marker.json', '.sandbox-secrets/sandbox_users.json']) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), '{}');
  }
  let args = adapter.args(input);
  assert.equal(args[0], '--no-daemon');
  assert.ok(args.includes('windows.sandbox="elevated"'));
  fs.writeFileSync(path.join(home, 'config.toml'), "[windows]\nsandbox = 'unelevated' # owner setting\n");
  args = adapter.args(input);
  assert.ok(args.includes('windows.sandbox="unelevated"'));
  assert.ok(!args.includes('windows.sandbox="elevated"'));
  fs.writeFileSync(path.join(home, 'config.toml'), 'windows.sandbox = "elevated"\n');
  assert.ok(adapter.args(input).includes('windows.sandbox="elevated"'));
  fs.writeFileSync(path.join(home, 'config.toml'), '[windows]\nsandbox = "unknown"\n');
  assert.throws(() => adapter.args(input), /could not verify[\s\S]*No model call/);
});

test('opencode: parses text, sums usage over steps, counts tools', () => {
  const plain = getAdapter('opencode').parse({ stdout: fixture('opencode.stdout.jsonl'), stderr: '', code: 0 });
  assert.equal(plain.error, null);
  assert.equal(plain.text, '4');
  assert.deepEqual(plain.usage, { input_tokens: 9164, output_tokens: 45, cache_read_tokens: 1600, cache_write_tokens: 0 });
  assert.equal(plain.session_id, 'ses_e597f69bdffemk05t3rPBQ0EW1');
  assert.equal(plain.finish_reason, 'stop');

  const tools = getAdapter('opencode').parse({ stdout: fixture('opencode.tool.stdout.jsonl'), stderr: '', code: 0 });
  assert.equal(tools.text, 'hello', 'the answer is the last message, not a tool round');
  assert.equal(tools.tool_calls, 2);
  assert.equal(tools.turn_count, 3);
  assert.deepEqual(tools.usage, { input_tokens: 27714, output_tokens: 176, cache_read_tokens: 19968, cache_write_tokens: 0 });
});

test('opencode: an error event is a typed error, not an answer', () => {
  const out = getAdapter('opencode').parse({ stdout: fixture('opencode.error.stdout.jsonl'), stderr: '', code: 1 });
  assert.equal(out.text, null);
  assert.deepEqual(out.error, { type: 'provider.no-route', message: 'Model unavailable: opencode/no-such-model' });
});

test('opencode: private server, provider/model#effort, prompt as one argument', () => {
  const args = getAdapter('opencode').args({ model: 'openai/gpt-6-luna', effort: 'low', prompt: 'a "quoted"\nprompt' });
  assert.deepEqual(args, ['run', '--standalone', '--format', 'json', '-m', 'openai/gpt-6-luna#low', '--', 'a "quoted"\nprompt']);
  assert.equal(getAdapter('opencode').args({ model: 'opencode/beam-free', prompt: '-x' })[5], 'opencode/beam-free');
  assert.deepEqual(getAdapter('opencode').args({ model: 'm', prompt: '-x' }).slice(-2), ['--', '-x'], 'a prompt that starts with a dash is never a flag');
});

// The ladder-answer pilot found OpenCode running shell, write and edit tools in answer mode.
test('opencode: answer mode denies every permission through OPENCODE_CONFIG_CONTENT', () => {
  const answer = getAdapter('opencode').answer;
  assert.deepEqual(JSON.parse(answer.env.OPENCODE_CONFIG_CONTENT), { permission: { '*': 'deny' } });
  assert.match(answer.note, /text only/);
});

test('defineCli: answer env reaches an answer call and stays out of an edit call', async () => {
  const echoEnv = defineCli({
    name: 'echo-env',
    bin: 'node', // a bare name: the lab finds harness binaries on PATH
    answer: { env: { LAB_TEST_ANSWER: 'deny' }, note: 'test' },
    edit: { args: [] },
    args: () => ['-e', 'process.stdout.write(process.env.LAB_TEST_ANSWER || "unset")'],
    parse: ({ stdout }) => ({ text: stdout, error: null }),
  });
  const messages = [{ role: 'user', content: 'hi' }];
  assert.equal((await echoEnv.call({ messages, timeoutMs: 30000 })).text, 'deny');
  assert.equal((await echoEnv.call({ messages, timeoutMs: 30000, access: 'edit' })).text, 'unset');
});

// Review round 1 (Codex): an owner's own OPENCODE_CONFIG_CONTENT was replaced, not merged.
test('answer env: a value the caller already set is merged by the harness, and OpenCode keeps every other setting', async () => {
  const merged = defineCli({
    name: 'merge-env',
    bin: 'node',
    answer: { env: { LAB_TEST_ANSWER: 'ours' }, note: 'test', merge: (key, current, ours) => `${current}+${ours}` },
    args: () => ['-e', 'process.stdout.write(process.env.LAB_TEST_ANSWER || "unset")'],
    parse: ({ stdout }) => ({ text: stdout, error: null }),
  });
  const messages = [{ role: 'user', content: 'hi' }];
  assert.equal((await merged.call({ messages, timeoutMs: 30000, env: { LAB_TEST_ANSWER: 'theirs' } })).text, 'theirs+ours');
  assert.equal((await merged.call({ messages, timeoutMs: 30000 })).text, 'ours', 'nothing to merge');

  const opencode = getAdapter('opencode');
  const own = JSON.stringify({ provider: { x: { name: 'X' } }, permission: { bash: 'allow' }, instructions: ['a.md'] });
  const out = JSON.parse(opencode.answerEnv({ OPENCODE_CONFIG_CONTENT: own }).OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(out, { provider: { x: { name: 'X' } }, permission: { '*': 'deny' }, instructions: ['a.md'] }, 'only permission is replaced');
  assert.deepEqual(JSON.parse(opencode.answerEnv({ OPENCODE_CONFIG_CONTENT: 'not json' }).OPENCODE_CONFIG_CONTENT), { permission: { '*': 'deny' } });
  assert.deepEqual(JSON.parse(opencode.answerEnv({}).OPENCODE_CONFIG_CONTENT), { permission: { '*': 'deny' } });
});

test('an isolated call clears inherited config variables, in any spelling; a normal call keeps them', async () => {
  const echo = defineCli({
    name: 'clear-env',
    bin: 'node',
    isolation: { clearEnv: ['LAB_TEST_OWN_CONFIG'], note: 'test' },
    answer: { env: { LAB_TEST_OWN_CONFIG: 'ours' }, note: 'test', merge: (key, current, ours) => `${current}+${ours}` },
    args: () => ['-e', 'process.stdout.write(String(process.env.LAB_TEST_OWN_CONFIG))'],
    parse: ({ stdout }) => ({ text: stdout, error: null }),
  });
  const messages = [{ role: 'user', content: 'hi' }];
  const mine = { env: { LAB_TEST_OWN_CONFIG: 'mine' } };
  assert.equal((await echo.call({ messages, timeoutMs: 30000, ...mine })).text, 'mine+ours');
  assert.equal((await echo.call({ messages, timeoutMs: 30000, isolated: true, ...mine })).text, 'ours', 'nothing inherited reaches the merge');
  assert.equal((await echo.call({ messages, timeoutMs: 30000, isolated: true, access: 'edit', ...mine })).text, 'undefined', 'an edit call has no value of ours');
  assert.equal((await echo.call({ messages, timeoutMs: 30000, isolated: true, access: 'edit', env: { lab_test_own_config: 'mine' } })).text, 'undefined', 'another spelling is cleared too');
  assert.deepEqual(getAdapter('opencode').isolation.clearEnv, ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT']);
});
