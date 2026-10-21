// Command Code headless: `cmdc -p <prompt> --output-format json`, an NDJSON
// event stream that ends with a `result` line.

import { cliVersion, flattenMessages, jsonLines, runProcess, stderrError, stderrTail } from './process.mjs';

const BIN = 'cmdc';

export default {
  name: 'command-code',
  kind: 'cli',
  entrypoint: 'headless',
  access_method: 'subscription',
  supports_effort: true,
  supports_decoding: false,

  detect: async () => ({ version: await cliVersion(BIN) }),

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
      if (/^tool_(call_)?start$/.test(event.type) || event.type === 'tool_use') toolCalls += 1;
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

  async call({ model, messages, effort, cwd, timeoutMs, persist = false, maxTurns = null }) {
    const { prompt } = flattenMessages(messages);
    const run = await runProcess(BIN, this.args({ model, effort, prompt, persist, maxTurns }), { cwd, timeoutMs });
    if (run.error) return { error: run.error, wall_ms: run.ms, events: [] };
    return { ...this.parse(run), wall_ms: run.ms, stderr: run.stderr };
  },

  applied({ effort }) {
    return effort ? { reasoning_effort: effort } : {};
  },
};
