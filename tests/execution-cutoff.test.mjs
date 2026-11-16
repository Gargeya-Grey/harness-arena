import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../lab/adapters/process.mjs';
import { defineCli } from '../lab/adapters/cli.mjs';
import { planFromExperiment } from '../lab/commands/run.mjs';
import { resolveExperiment } from '../lab/lib/repo.mjs';

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/repo');
const experiment = { id: 'deadline-proof', suite: 'smoke', prompt: 'qa-single-turn', targets: [{ model: 'claude-haiku', harness: 'claude-code' }], repeats: 1 };

test('new experiment plans have no execution deadline unless one is requested', () => {
  assert.equal(planFromExperiment(fixtureRoot, experiment).timeoutMs, 0);
  assert.equal(planFromExperiment(fixtureRoot, { ...experiment, timeout_s: 0 }).timeoutMs, 0);
  assert.equal(planFromExperiment(fixtureRoot, { ...experiment, timeout_s: 600 }).timeoutMs, 600000);
});

test('invalid execution deadlines are rejected before a model call', () => {
  for (const timeout_s of [-1, 'soon', Infinity, 2147484]) {
    assert.throws(() => planFromExperiment(fixtureRoot, { ...experiment, timeout_s }), /timeout_s/);
    assert.match(resolveExperiment({ ...experiment, timeout_s }, { 'claude-haiku': {} }).problems.join('\n'), /timeout_s/);
  }
});

test('a zero execution deadline lets a real process finish and records elapsed time', async () => {
  const result = await runProcess('node', ['-e', 'setTimeout(() => console.log("finished"), 100)'], { timeoutMs: 0 });
  assert.equal(result.error, null);
  assert.equal(result.stdout.trim(), 'finished');
  assert.ok(result.ms >= 100);
});

test('an execution cutoff retains native diagnostics without presenting a finished answer', async () => {
  let cleanedSession = null;
  const adapter = defineCli({
    name: 'cutoff-diagnostics',
    bin: 'node',
    args: () => ['-e', 'console.log(JSON.stringify({session_id:"native-session",model_reported:"test-model",tool_calls:4,usage:{input_tokens:70,output_tokens:9},text:"unfinished"})); setInterval(() => {}, 1000)'],
    parse: ({ stdout }) => ({ ...JSON.parse(stdout), events: [{ type: 'native-event' }], error: null }),
    after: async (parsed) => { cleanedSession = parsed.session_id; },
  });
  const result = await adapter.call({ messages: [{ role: 'user', content: 'build' }], timeoutMs: 1500 });
  assert.equal(result.error.type, 'timeout');
  assert.equal(result.text, null);
  assert.equal(result.finish_reason, null);
  assert.equal(result.tool_calls, 4);
  assert.equal(result.session_id, 'native-session');
  assert.equal(result.model_reported, 'test-model');
  assert.deepEqual(result.usage, { input_tokens: 70, output_tokens: 9 });
  assert.deepEqual(result.events, [{ type: 'native-event' }]);
  assert.equal(cleanedSession, 'native-session');
});
