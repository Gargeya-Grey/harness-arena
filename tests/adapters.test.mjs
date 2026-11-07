// Adapter parsers on real recorded harness output (tests/fixtures/harness/).
// The expected usage is what the smoke runs stored in raw.jsonl.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, getAdapter } from '../lab/adapters/index.mjs';
import { flattenMessages, stderrError } from '../lab/adapters/process.mjs';
import { defineCli } from '../lab/adapters/cli.mjs';

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
