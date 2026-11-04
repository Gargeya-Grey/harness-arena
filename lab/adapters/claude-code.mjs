// Claude Code headless: `claude -p --output-format stream-json --verbose`.
// The prompt goes in on stdin. Usage comes from the final `result` event.

import { defineCli } from './cli.mjs';
import { jsonLines, stderrError, stderrTail } from './process.mjs';

const BIN = 'claude';

export default defineCli({
  name: 'claude-code',
  bin: BIN,
  supportsEffort: true,
  stdin: ({ user }) => user,
  // Measured 2026-11-04: drops user MCP servers and skills (34,525 to 29,316 prompt
  // tokens on a one-word reply); built-in plugins and the base prompt still load.
  // --bare would skip more, but it accepts only ANTHROPIC_API_KEY, not a subscription.
  // Agent tasks: file edits are accepted and these tools run without a prompt. No web tools.
  edit: { args: ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash,Read,Edit,Write,Glob,Grep'], note: 'Edits files and runs shell commands; web tools stay off.' },
  isolation: {
    args: ['--setting-sources', 'project,local', '--strict-mcp-config', '--disable-slash-commands'],
    note: 'Skips user settings, MCP servers, skills and slash commands. Built-in plugins still load.',
  },

  args({ model, effort, system, persist }) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model];
    if (effort) args.push('--effort', effort);
    if (system) args.push('--append-system-prompt', system);
    if (!persist) args.push('--no-session-persistence');
    return args;
  },

  parse({ stdout, stderr, code }) {
    const events = jsonLines(stdout);
    const result = [...events].reverse().find((event) => event.type === 'result') || null;
    const init = events.find((event) => event.type === 'system' && event.subtype === 'init') || {};
    let toolCalls = 0;
    const skills = new Set();
    for (const event of events) {
      if (event.type !== 'assistant') continue;
      for (const block of event.message?.content || []) {
        if (block.type !== 'tool_use') continue;
        toolCalls += 1;
        if (block.name === 'Skill' && block.input?.skill) skills.add(String(block.input.skill));
      }
    }
    const usage = result?.usage || {};
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const hasUsage = typeof usage.input_tokens === 'number';
    let error = null;
    if (!result) error = stderrError(stderr) || { type: 'no_result', message: stderrTail(stderr) || `claude exited with code ${code} and no result event` };
    else if (result.is_error || result.subtype !== 'success') error = { type: result.subtype || 'harness_error', message: String(result.result || 'Claude Code reported an error') };
    return {
      text: result && !error ? String(result.result ?? '') : null,
      finish_reason: result?.stop_reason ?? (result ? 'end_turn' : null),
      usage: {
        // Anthropic counts cached tokens apart from input_tokens; the record counts all prompt tokens.
        input_tokens: hasUsage ? usage.input_tokens + cacheRead + cacheWrite : null,
        output_tokens: usage.output_tokens ?? null,
        cache_read_tokens: hasUsage ? cacheRead : null,
        cache_write_tokens: hasUsage ? cacheWrite : null,
      },
      harness_duration_ms: result?.duration_ms ?? null,
      model_request_duration_ms: result?.duration_api_ms ?? null,
      tool_calls: toolCalls,
      skills_used: [...skills],
      session_id: result?.session_id ?? init.session_id ?? null,
      model_reported: init.model ?? null,
      turn_count: result?.num_turns ?? null,
      harness_cost_usd: result?.total_cost_usd ?? null,
      events,
      error,
      extra: { model_usage: result?.modelUsage ?? null, tools_available: init.tools?.length ?? null },
    };
  },
});
