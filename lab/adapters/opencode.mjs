// OpenCode 2.x headless: `opencode run --standalone --format json -m provider/model[#variant] <prompt>`.
// It prints one JSON event per line: step_start, text, tool_use, step_finish, error.
// The model id names the provider (opencode/..., openai/..., openrouter/...), so any
// provider connected inside OpenCode works with no change here.

import path from 'node:path';
import { defineCli } from './cli.mjs';
import { createOpenCodeSignIn } from './opencode-signin.mjs';
import { jsonLines, runProcess, stderrError, stderrTail } from './process.mjs';

const BIN = 'opencode';

// OpenCode 2.x keeps its sign-ins in a database, not in auth.json (see opencode-signin.mjs).
// To place them in a temp home, OpenCode first makes its own empty database there.
const signIn = createOpenCodeSignIn({
  async init({ dir, env }) {
    const run = await runProcess(BIN, ['auth', 'list', '--standalone'], { cwd: dir, env, timeoutMs: 60000 });
    return run.error ? { error: { type: 'harness_error', message: `could not prepare the isolated OpenCode home: ${run.error.message}` } } : null;
  },
});

export default defineCli({
  name: 'opencode',
  bin: BIN,
  supportsEffort: true,
  edit: { args: ['--auto'], note: 'Auto-approves permissions that are not explicitly denied.' },
  // Without --auto, OpenCode 2.2.6 still runs shell, write and edit tools in `run` mode
  // (seen in the ladder-answer pilot). Config from OPENCODE_CONFIG_CONTENT has the last
  // word over the user's files; OpenCode reads `"*": "deny"` as one rule that denies
  // every action (`opencode debug config` shows it, checked on 2.2.6).
  answer: {
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { '*': 'deny' } }) },
    note: 'OPENCODE_CONFIG_CONTENT denies every permission, so the model replies in text only.',
    // A config the owner already passes in OPENCODE_CONFIG_CONTENT keeps every other setting;
    // only `permission` is replaced. A value that is not a JSON object cannot be merged,
    // and OpenCode could not read it either, so ours goes alone.
    merge(key, current, ours) {
      let base = null;
      try {
        base = JSON.parse(current);
      } catch {
        base = null;
      }
      if (!base || typeof base !== 'object' || Array.isArray(base)) return ours;
      return JSON.stringify({ ...base, ...JSON.parse(ours) });
    },
  },
  // `opencode debug paths` shows the config, data, state and cache folders; XDG_* and the
  // home folder move all of them (checked on 2.2.5). The temp home holds the provider
  // sign-ins only (OAuth and keys): the rows of the database's credential table. opencode.json,
  // plugins, rules, sessions and all other settings stay out. OAuth tokens refresh on use,
  // so a refreshed credential goes back to the real database.
  isolation: {
    // These point OpenCode at a config outside the temp home, so an inherited one would load the user's setup.
    clearEnv: ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT'],
    home: {
      files: [],
      store: signIn,
      env: (home) => ({
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_DATA_HOME: path.join(home, '.local', 'share'),
        XDG_STATE_HOME: path.join(home, '.local', 'state'),
        XDG_CACHE_HOME: path.join(home, '.cache'),
      }),
    },
    note: 'Runs with its own config, data and cache folders in a temp home that holds only the provider sign-ins (credential rows). Skips opencode.json, plugins, rules, sessions and custom providers; only providers that are signed in work.',
  },

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
  // An isolated call keeps its session in the temp home, which is deleted after the call
  // (so persist_sessions cannot keep it there).
  async after(parsed, { persist, cwd, tempHome }) {
    if (tempHome) {
      if (parsed.session_id) parsed.extra = { ...parsed.extra, session_deleted: true };
      return;
    }
    if (persist || !parsed.session_id) return;
    const run = await runProcess(BIN, ['session', 'delete', parsed.session_id, '--standalone'], { cwd, timeoutMs: 30000 });
    parsed.extra = { ...parsed.extra, session_deleted: !run.error && run.code === 0 };
  },
});
