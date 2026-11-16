import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getAdapter } from '../lab/adapters/index.mjs';

const parse = events => getAdapter('claude-code').parse({ stdout: events.map(event => JSON.stringify(event)).join('\n'), stderr: '', code: 0 });
const result = (extra = {}) => ({ type: 'result', subtype: 'success', session_id: 'root', result: 'Implementation complete.', duration_ms: 100, duration_api_ms: 80, num_turns: 2, total_cost_usd: 0.1, usage: { input_tokens: 10, output_tokens: 20 }, ...extra });

test('Claude multi-result session keeps the primary answer and accounts for both root episodes', () => {
  const stdout = fs.readFileSync(new URL('./fixtures/harness/claude-code.multi-result.stdout.jsonl', import.meta.url), 'utf8');
  const parsed = getAdapter('claude-code').parse({ stdout, stderr: '', code: 0 });
  assert.equal(parsed.error, null);
  assert.match(parsed.text, /^The SQL engine is built\./);
  assert.equal(parsed.usage.output_tokens, 132299);
  assert.equal(parsed.usage.input_tokens, 2250447);
  assert.equal(parsed.usage.cache_read_tokens, 2105613);
  assert.equal(parsed.usage.cache_write_tokens, 144798);
  assert.equal(parsed.turn_count, 17);
  assert.equal(parsed.harness_duration_ms, 731667);
  assert.equal(parsed.model_request_duration_ms, 550184);
  assert.equal(parsed.harness_cost_usd, 0.36602240999999996);
  assert.equal(parsed.tool_calls, 15);
  assert.equal(parsed.extra.root_result_count, 2);
  assert.equal(parsed.extra.primary_harness_duration_ms, 728580);
  assert.equal(parsed.extra.measurement_scopes.usage, 'sum of distinct root episode usage');
});

test('Claude ignores nested-session results and deduplicates a repeated identified result', () => {
  const primary = result({ uuid: 'episode-1' });
  const parsed = parse([
    { type: 'system', subtype: 'init', session_id: 'root' },
    primary,
    result({ parent_tool_use_id: 'tool-1', session_id: 'child', result: 'Nested reply.', usage: { input_tokens: 999, output_tokens: 999 } }),
    primary,
    result({ uuid: 'episode-2', result: 'Background notification.', usage: { input_tokens: 5, output_tokens: 3 }, num_turns: 1, duration_ms: 10, duration_api_ms: 88, total_cost_usd: 0.12 }),
  ]);
  assert.equal(parsed.text, 'Implementation complete.');
  assert.equal(parsed.usage.output_tokens, 23);
  assert.equal(parsed.turn_count, 3);
  assert.equal(parsed.harness_duration_ms, 110);
  assert.equal(parsed.model_request_duration_ms, 88);
  assert.equal(parsed.harness_cost_usd, 0.12);
  assert.equal(parsed.extra.root_result_count, 2);
});

test('Claude keeps post-primary errors visible without discarding a delivered primary output', () => {
  const parsed = parse([result(), result({ subtype: 'error_during_execution', is_error: true, result: 'A background check failed.' })]);
  assert.equal(parsed.text, 'Implementation complete.');
  assert.equal(parsed.error, null);
  assert.equal(parsed.extra.post_primary_errors.length, 1);
  assert.match(parsed.extra.post_primary_errors[0].message, /background check failed/);
  assert.equal(parse([result({ subtype: 'error_max_turns', is_error: true, result: 'No output.' })]).error.type, 'error_max_turns');
});

test('Claude does not invent aggregate usage when an episode omits its usage', () => {
  const parsed = parse([result(), result({ usage: undefined })]);
  assert.equal(parsed.usage.output_tokens, null);
  assert.equal(parsed.usage.input_tokens, null);
});

test('Codex isolated benchmark instructions follow the supplied task tool policy', () => {
  const flags = getAdapter('codex').isolation.flags;
  if (process.platform !== 'win32') return;
  const instruction = flags.find(value => value.startsWith('developer_instructions='));
  assert(instruction);
  assert.match(instruction, /When the task forbids tools, do not call tools/);
  assert.doesNotMatch(instruction, /Use built-in local tools to edit and verify the current workspace/);
});
