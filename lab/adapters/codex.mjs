// OpenAI Codex CLI: `codex exec --json`, read-only sandbox, prompt on stdin.

import { defineCli } from './cli.mjs';
import { jsonLines, stderrError, stderrTail } from './process.mjs';

const BIN = 'codex';
const TOOL_ITEMS = new Set(['command_execution', 'mcp_tool_call', 'web_search', 'file_change', 'tool_call']);

export default defineCli({
  name: 'codex',
  bin: BIN,
  supportsEffort: true,
  stdin: ({ prompt }) => prompt,

  args({ model, effort, cwd, persist }) {
    const args = ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '--color', 'never', '-m', model];
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
    if (cwd) args.push('-C', cwd);
    if (!persist) args.push('--ephemeral');
    args.push('-');
    return args;
  },

  parse({ stdout, stderr, code }) {
    const events = jsonLines(stdout);
    let text = null;
    let toolCalls = 0;
    let usage = null;
    let sessionId = null;
    let failure = null;
    let turns = 0;
    for (const event of events) {
      if (event.type === 'thread.started') sessionId = event.thread_id ?? null;
      if (event.type === 'turn.started') turns += 1;
      if (event.type === 'item.completed' && event.item) {
        if (event.item.type === 'agent_message') text = String(event.item.text ?? '');
        if (TOOL_ITEMS.has(event.item.type)) toolCalls += 1;
      }
      if (event.type === 'turn.completed' && event.usage) {
        // Sum across turns; Codex reports OpenAI-style usage where input includes cached tokens.
        usage = usage || { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
        for (const key of Object.keys(usage)) usage[key] += event.usage[key] ?? 0;
      }
      if (event.type === 'turn.failed') failure = { type: 'harness_error', message: String(event.error?.message ?? 'turn failed') };
      if (event.type === 'error') failure = failure || { type: 'harness_error', message: String(event.message ?? 'error') };
    }
    let error = failure;
    if (!error && text === null) error = stderrError(stderr) || { type: 'no_result', message: stderrTail(stderr) || `codex exited with code ${code} and no agent message` };
    return {
      text: error ? null : text,
      finish_reason: error ? null : 'end_turn',
      usage: {
        input_tokens: usage ? usage.input_tokens : null,
        output_tokens: usage ? usage.output_tokens : null,
        cache_read_tokens: usage ? usage.cached_input_tokens : null,
        cache_write_tokens: usage ? 0 : null,
      },
      harness_duration_ms: null,
      model_request_duration_ms: null,
      tool_calls: toolCalls,
      skills_used: [],
      session_id: sessionId,
      model_reported: null,
      turn_count: turns || null,
      harness_cost_usd: null,
      events,
      error,
      extra: { reasoning_output_tokens: usage?.reasoning_output_tokens ?? null },
    };
  },
});
