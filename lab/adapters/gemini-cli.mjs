// Gemini CLI headless: `gemini -p <prompt> -o json`. It has no effort flag, so
// a requested effort is reported as not applied.

import { defineCli } from './cli.mjs';
import { lastJsonObject, stderrError, stderrTail } from './process.mjs';

const BIN = 'gemini';

export default defineCli({
  name: 'gemini-cli',
  bin: BIN,
  supportsEffort: false,

  args({ model, prompt }) {
    return ['-p', prompt, '-m', model, '-o', 'json', '--skip-trust'];
  },

  parse({ stdout, stderr, code }) {
    const result = lastJsonObject(stdout);
    const models = result?.stats?.models || {};
    let input = null;
    let output = null;
    let cached = null;
    let thoughts = null;
    let apiMs = null;
    for (const stats of Object.values(models)) {
      const tokens = stats.tokens || {};
      input = (input ?? 0) + (tokens.prompt ?? tokens.input ?? 0);
      // Thinking tokens are billed as output.
      output = (output ?? 0) + (tokens.candidates ?? 0) + (tokens.thoughts ?? 0);
      cached = (cached ?? 0) + (tokens.cached ?? 0);
      thoughts = (thoughts ?? 0) + (tokens.thoughts ?? 0);
      apiMs = (apiMs ?? 0) + (stats.api?.totalLatencyMs ?? 0);
    }
    let error = null;
    if (!result) error = stderrError(stderr) || { type: 'no_result', message: stderrTail(stderr) || `gemini exited with code ${code} and no JSON result` };
    else if (result.error) error = { type: String(result.error.type || 'harness_error'), message: String(result.error.message || JSON.stringify(result.error)) };
    else if (typeof result.response !== 'string') error = { type: 'no_result', message: 'gemini returned no response text' };
    return {
      text: error ? null : result.response,
      finish_reason: error ? null : 'end_turn',
      usage: { input_tokens: input, output_tokens: output, cache_read_tokens: cached, cache_write_tokens: input == null ? null : 0 },
      harness_duration_ms: null,
      model_request_duration_ms: apiMs,
      tool_calls: result?.stats?.tools?.totalCalls ?? 0,
      skills_used: [],
      session_id: result?.session_id ?? result?.sessionId ?? null,
      model_reported: Object.keys(models).join(', ') || null,
      turn_count: null,
      harness_cost_usd: null,
      events: result ? [result] : [],
      error,
      extra: { thought_tokens: thoughts, models: Object.keys(models) },
    };
  },
});
