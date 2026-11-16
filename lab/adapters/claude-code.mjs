// Claude Code headless: `claude -p --output-format stream-json --verbose`.
// The prompt goes in on stdin. A session may emit a primary result and later notifications.

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
    // The flags do not cover instruction files. The call folder is under the home folder on
    // Windows (os.tmpdir()), so ~/.claude/CLAUDE.md is found as a parent folder's file, and the
    // auto memory of the home folder's project loads too.
    env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
    note: 'Skips user settings, MCP servers, skills, slash commands, CLAUDE.md files and auto memory. Built-in plugins still load.',
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
    const init = events.find((event) => event.type === 'system' && event.subtype === 'init') || {};
    const candidates = events.filter((event) => event.type === 'result' && !event.parent_tool_use_id);
    const rootSession = init.session_id ?? candidates[0]?.session_id ?? null;
    const seenResults = new Set();
    const results = candidates.filter((event) => {
      if (rootSession && event.session_id && event.session_id !== rootSession) return false;
      if (!event.uuid) return true;
      if (seenResults.has(event.uuid)) return false;
      seenResults.add(event.uuid);
      return true;
    });
    const result = results[0] || null;
    const latest = results.at(-1) || null;
    let toolCalls = 0;
    const seenTools = new Set();
    const skills = new Set();
    for (const event of events) {
      if (event.type !== 'assistant') continue;
      for (const block of event.message?.content || []) {
        if (block.type !== 'tool_use') continue;
        if (block.id && seenTools.has(block.id)) continue;
        if (block.id) seenTools.add(block.id);
        toolCalls += 1;
        if (block.name === 'Skill' && block.input?.skill) skills.add(String(block.input.skill));
      }
    }
    const sum = (get) => {
      const values = results.map(get);
      return values.length && values.every((value) => Number.isFinite(value) && value >= 0) ? values.reduce((total, value) => total + value, 0) : null;
    };
    const hasUsage = results.length > 0 && results.every((event) => Number.isFinite(event.usage?.input_tokens));
    const cacheRead = hasUsage ? sum((event) => event.usage.cache_read_input_tokens ?? 0) : null;
    const cacheWrite = hasUsage ? sum((event) => event.usage.cache_creation_input_tokens ?? 0) : null;
    const input = hasUsage ? sum((event) => event.usage.input_tokens + (event.usage.cache_read_input_tokens ?? 0) + (event.usage.cache_creation_input_tokens ?? 0)) : null;
    const output = sum((event) => event.usage?.output_tokens);
    let error = null;
    if (!result) error = stderrError(stderr) || { type: 'no_result', message: stderrTail(stderr) || `claude exited with code ${code} and no result event` };
    else if (result.is_error || result.subtype !== 'success') error = { type: result.subtype || 'harness_error', message: String(result.result || 'Claude Code reported an error') };
    return {
      text: result && !error ? String(result.result ?? '') : null,
      finish_reason: result?.stop_reason ?? (result ? 'end_turn' : null),
      usage: {
        // Anthropic counts cached tokens apart from input_tokens; the record counts all prompt tokens.
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cacheRead,
        cache_write_tokens: cacheWrite,
      },
      harness_duration_ms: sum((event) => event.duration_ms),
      model_request_duration_ms: latest?.duration_api_ms ?? null,
      tool_calls: toolCalls,
      skills_used: [...skills],
      session_id: result?.session_id ?? init.session_id ?? null,
      model_reported: init.model ?? null,
      turn_count: sum((event) => event.num_turns),
      harness_cost_usd: latest?.total_cost_usd ?? null,
      events,
      error,
      extra: {
        model_usage: latest?.modelUsage ?? null,
        tools_available: init.tools?.length ?? null,
        root_result_count: results.length,
        primary_harness_duration_ms: result?.duration_ms ?? null,
        measurement_scopes: { response: 'first root result', usage: 'sum of distinct root episode usage', harness_duration_ms: 'sum of root episode durations', model_usage: 'last root provider cumulative snapshot', model_request_duration_ms: 'last root provider cumulative API duration', harness_cost_usd: 'last root provider cumulative cost' },
        post_primary_errors: results.slice(1).filter((event) => event.is_error || event.subtype !== 'success').map((event) => ({ type: event.subtype || 'harness_error', message: String(event.result || 'Claude Code reported a post-primary error') })),
      },
    };
  },
});
