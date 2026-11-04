// OpenCode 2.x headless: `opencode run --standalone --format json -m provider/model[#variant] <prompt>`.
// It prints one JSON event per line: step_start, text, tool_use, step_finish, error.
// The model id names the provider (opencode/..., openai/..., openrouter/...), so any
// provider connected inside OpenCode works with no change here.

import { defineCli } from './cli.mjs';
import { jsonLines, runProcess, stderrError, stderrTail } from './process.mjs';

const BIN = 'opencode';

export default defineCli({
  name: 'opencode',
  bin: BIN,
  supportsEffort: true,
  edit: { args: ['--auto'], note: 'Auto-approves permissions that are not explicitly denied.' },

  // --standalone gives each call a private server, so a call never shares state
  // with the user's background OpenCode service. `--` keeps a prompt that starts
  // with "-" from being read as a flag (checked on 2.2.5).
  args({ model, effort, prompt }) {
    return ['run', '--standalone', '--format', 'json', '-m', effort ? `${model}#${effort}` : model, '--', prompt];
  },

  parse({ stdout, stderr, code }) {
    const events = jsonLines(stdout);
    const texts = events.filter((event) => event.type === 'text' && typeof event.part?.text === 'string');
    const finishes = events.filter((event) => event.type === 'step_finish' && event.part);
    const failure = events.find((event) => event.type === 'error');
    // The answer is the text of the last assistant message; earlier steps are tool rounds.
    const lastMessage = texts.at(-1)?.part.messageID;
    const text = texts.length ? texts.filter((event) => event.part.messageID === lastMessage).map((event) => event.part.text).join('') : null;
    let usage = null;
    let cost = null;
    for (const { part } of finishes) {
      const tokens = part.tokens || {};
      usage = usage || { input: 0, output: 0, reasoning: 0, read: 0, write: 0 };
      usage.input += tokens.input ?? 0;
      usage.output += tokens.output ?? 0;
      usage.reasoning += tokens.reasoning ?? 0;
      usage.read += tokens.cache?.read ?? 0;
      usage.write += tokens.cache?.write ?? 0;
      if (typeof part.cost === 'number') cost = (cost ?? 0) + part.cost;
    }
    let error = null;
    if (failure) error = { type: String(failure.error?.type || 'harness_error'), message: String(failure.error?.message || 'OpenCode reported an error') };
    else if (text === null) error = stderrError(stderr) || { type: 'no_result', message: stderrTail(stderr) || `opencode exited with code ${code} and no text event` };
    return {
      text: error ? null : text,
      finish_reason: error ? null : finishes.at(-1)?.part.reason ?? null,
      // OpenCode reports input without cache tokens and output without reasoning
      // tokens (a one-digit answer shows output 1, reasoning 44); the record counts
      // every prompt token as input and reasoning as output.
      usage: {
        input_tokens: usage ? usage.input + usage.read + usage.write : null,
        output_tokens: usage ? usage.output + usage.reasoning : null,
        cache_read_tokens: usage ? usage.read : null,
        cache_write_tokens: usage ? usage.write : null,
      },
      harness_duration_ms: events.length > 1 ? events.at(-1).timestamp - events[0].timestamp : null,
      model_request_duration_ms: null,
      tool_calls: events.filter((event) => event.type === 'tool_use').length,
      skills_used: [],
      session_id: events.find((event) => event.sessionID)?.sessionID ?? null,
      model_reported: null,
      turn_count: finishes.length || null,
      harness_cost_usd: cost,
      events,
      error,
      extra: usage ? { reasoning_output_tokens: usage.reasoning } : {},
    };
  },

  // OpenCode stores every session. Unless the experiment keeps sessions, delete
  // the one this call made, so test runs do not fill the user's session list.
  // The row records whether the delete worked (harness_extra.session_deleted).
  async after(parsed, { persist, cwd }) {
    if (persist || !parsed.session_id) return;
    const run = await runProcess(BIN, ['session', 'delete', parsed.session_id, '--standalone'], { cwd, timeoutMs: 30000 });
    parsed.extra = { ...parsed.extra, session_deleted: !run.error && run.code === 0 };
  },
});
