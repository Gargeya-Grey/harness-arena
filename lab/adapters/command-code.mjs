// Command Code headless: `cmdc -p <prompt> --output-format json`, an NDJSON
// event stream that ends with a `result` line.

import { defineCli } from './cli.mjs';
import { jsonLines, stderrError, stderrTail } from './process.mjs';

const BIN = 'cmdc';

export default defineCli({
  name: 'command-code',
  bin: BIN,
  supportsEffort: true,
  edit: { args: ['--yolo', '--tools-all'], note: 'Every tool, no permission prompts.' },
  isolation: { args: ['--no-skills'], note: 'Skips skill discovery. User settings and memory still load.' },

  args({ model, effort, prompt, persist, maxTurns }) {
    const args = ['-p', prompt, '--model', model, '--output-format', 'json', '--skip-onboarding', '--no-auto-update'];
    if (effort) args.push('--effort', effort);
    if (maxTurns) args.push('--max-turns', String(maxTurns));
    if (!persist) args.push('--no-session');
    return args;
  },

  parse({ stdout, stderr, code }) {
    const lines = jsonLines(stdout);
    const result = [...lines].reverse().find((line) => line.type === 'result') || null;
    const events = lines.filter((line) => line.type === 'event').map((line) => line.event);
    let toolCalls = 0;
    const seenTools = new Set();
    let requestMs = 0;
    let requestOpen = null;
    let model = null;
    let effort = null;
    let sessionId = result?.sessionId ?? null;
    let turns = null;
    for (const event of events) {
      if (event.type === 'run_start') sessionId = sessionId ?? event.sessionId ?? null;
      if (event.type === 'model_request_start') {
        model = event.model ?? model;
        requestOpen = event.timestamp ?? null;
      }
      if (event.type === 'model_request_end') {
        effort = event.effort ?? effort;
        if (typeof event.durationMs === 'number') requestMs += event.durationMs;
        else if (requestOpen && event.timestamp) requestMs += Date.parse(event.timestamp) - Date.parse(requestOpen);
      }
      // Older versions send tool_start or tool_use; 1.88 sends tool_queued, tool_running and
      // tool_completed (or tool_errored) for each call. Count each call once, by its id.
      if (/^tool_((call_)?start|queued)$/.test(event.type) || event.type === 'tool_use') {
        const id = event.toolCallId ?? event.id ?? null;
        if (id === null) toolCalls += 1;
        else if (!seenTools.has(id)) {
          seenTools.add(id);
          toolCalls += 1;
        }
      }
      if (event.type === 'run_end') turns = event.result?.turnCount ?? turns;
    }
    const usage = result?.usage || {};
    let error = null;
    if (!result) error = stderrError(stderr) || { type: 'no_result', message: stderrTail(stderr) || `cmdc exited with code ${code} and no result line` };
    else if (result.subtype !== 'success') error = { type: String(result.subtype || 'harness_error'), message: String(result.error || result.finalText || 'Command Code reported an error') };
    return {
      text: error ? null : String(result.finalText ?? ''),
      finish_reason: result?.stopReason ?? null,
      usage: {
        input_tokens: usage.inputTokens ?? null,
        output_tokens: usage.outputTokens ?? null,
        cache_read_tokens: usage.cacheReadTokens ?? null,
        cache_write_tokens: usage.cacheWriteTokens ?? null,
      },
      harness_duration_ms: result?.durationMs ?? null,
      model_request_duration_ms: requestMs || null,
      tool_calls: toolCalls,
      skills_used: [],
      session_id: sessionId,
      model_reported: model,
      effort_reported: effort,
      turn_count: turns,
      harness_cost_usd: null,
      events: lines,
      error,
      extra: {},
    };
  },
});
