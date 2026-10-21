// Direct provider APIs over HTTP (no SDK, by the zero-dependency rule):
// the Anthropic Messages API and any OpenAI-compatible chat completions API.
// Keys come from the environment only and are never written to a record.

async function postJson(url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON error page; reported below.
    }
    return { status: response.status, json, text, ms: Date.now() - started, error: null };
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    return {
      status: null,
      json: null,
      text: '',
      ms: Date.now() - started,
      error: { type: timedOut ? 'timeout' : 'network_error', message: timedOut ? `No response within ${Math.round(timeoutMs / 1000)} s` : error.message },
    };
  } finally {
    clearTimeout(timer);
  }
}

function httpError(response) {
  if (response.error) return response.error;
  if (response.status >= 200 && response.status < 300) return null;
  const message = response.json?.error?.message || response.json?.message || response.text.slice(0, 300) || `HTTP ${response.status}`;
  return { type: `http_${response.status}`, message: String(message) };
}

const empty = (error, ms) => ({
  text: null,
  finish_reason: null,
  usage: { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null },
  harness_duration_ms: null,
  model_request_duration_ms: ms,
  tool_calls: 0,
  skills_used: [],
  session_id: null,
  model_reported: null,
  turn_count: 1,
  harness_cost_usd: null,
  events: [],
  error,
  extra: {},
  wall_ms: ms,
});

export const anthropicApi = {
  name: 'anthropic-api',
  kind: 'api',
  entrypoint: 'api',
  access_method: 'api_key',
  supports_effort: true,
  supports_decoding: true,
  key_env: 'ANTHROPIC_API_KEY',

  detect: async () => ({ version: '2023-06-01', credentials: Boolean(process.env.ANTHROPIC_API_KEY) }),

  body({ model, messages, params, effort }) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const body = {
      model,
      max_tokens: params.max_tokens ?? 1024,
      messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
    };
    if (system) body.system = system;
    if (params.temperature != null) body.temperature = params.temperature;
    if (effort) body.output_config = { effort };
    return body;
  },

  parse(json) {
    const usage = json?.usage || {};
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const hasUsage = typeof usage.input_tokens === 'number';
    const text = (json?.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('');
    const refused = json?.stop_reason === 'refusal';
    return {
      text: refused ? null : text,
      finish_reason: json?.stop_reason ?? null,
      usage: {
        input_tokens: hasUsage ? usage.input_tokens + cacheRead + cacheWrite : null,
        output_tokens: usage.output_tokens ?? null,
        cache_read_tokens: hasUsage ? cacheRead : null,
        cache_write_tokens: hasUsage ? cacheWrite : null,
      },
      model_reported: json?.model ?? null,
      session_id: json?.id ?? null,
      error: refused ? { type: 'refusal', message: String(json?.stop_details?.explanation || json?.stop_details?.category || 'Model declined') } : null,
    };
  },

  async call({ model, messages, params = {}, effort, timeoutMs }) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return empty({ type: 'missing_credentials', message: 'Set ANTHROPIC_API_KEY to use anthropic-api' }, 0);
    const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    const response = await postJson(`${base}/v1/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, this.body({ model, messages, params, effort }), timeoutMs);
    const error = httpError(response);
    if (error) return empty(error, response.ms);
    return { ...empty(null, response.ms), ...this.parse(response.json), events: [response.json] };
  },

  applied({ params = {}, effort }) {
    const applied = { max_tokens: params.max_tokens ?? 1024 };
    if (params.temperature != null) applied.temperature = params.temperature;
    if (effort) applied.reasoning_effort = effort;
    return applied;
  },
};

function openAiCompatible({ name, baseEnv, defaultBase, keyEnv }) {
  return {
    name,
    kind: 'api',
    entrypoint: 'api',
    access_method: 'api_key',
    supports_effort: true,
    supports_decoding: true,
    key_env: keyEnv,

    detect: async () => ({ version: 'v1', credentials: Boolean(process.env[keyEnv]) }),

    body({ model, messages, params, effort }) {
      const body = { model, messages: messages.map((m) => ({ role: m.role, content: m.content })) };
      if (params.temperature != null) body.temperature = params.temperature;
      if (params.max_completion_tokens != null) body.max_completion_tokens = params.max_completion_tokens;
      else if (params.max_tokens != null) body.max_tokens = params.max_tokens;
      if (params.seed != null) body.seed = params.seed;
      if (effort) body.reasoning_effort = effort;
      return body;
    },

    parse(json) {
      const choice = json?.choices?.[0] || {};
      const usage = json?.usage || {};
      // OpenAI-style prompt_tokens already include cached tokens.
      const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
      const hasUsage = typeof usage.prompt_tokens === 'number';
      return {
        text: typeof choice.message?.content === 'string' ? choice.message.content : null,
        finish_reason: choice.finish_reason ?? null,
        usage: {
          input_tokens: hasUsage ? usage.prompt_tokens : null,
          output_tokens: usage.completion_tokens ?? null,
          cache_read_tokens: hasUsage ? cached : null,
          cache_write_tokens: hasUsage ? 0 : null,
        },
        tool_calls: choice.message?.tool_calls?.length ?? 0,
        model_reported: json?.model ?? null,
        session_id: json?.id ?? null,
        extra: { reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? null },
        error: choice.message?.content == null ? { type: 'no_result', message: 'Response had no message content' } : null,
      };
    },

    async call({ model, messages, params = {}, effort, timeoutMs }) {
      const key = process.env[keyEnv];
      if (!key) return empty({ type: 'missing_credentials', message: `Set ${keyEnv} to use ${name}` }, 0);
      const base = (process.env[baseEnv] || defaultBase).replace(/\/+$/, '');
      const response = await postJson(`${base}/chat/completions`, { authorization: `Bearer ${key}` }, this.body({ model, messages, params, effort }), timeoutMs);
      const error = httpError(response);
      if (error) return empty(error, response.ms);
      return { ...empty(null, response.ms), ...this.parse(response.json), events: [response.json] };
    },

    applied({ params = {}, effort }) {
      const applied = {};
      for (const key of ['temperature', 'max_tokens', 'max_completion_tokens', 'seed']) {
        if (params[key] != null) applied[key] = params[key];
      }
      if (effort) applied.reasoning_effort = effort;
      return applied;
    },
  };
}

export const openaiApi = openAiCompatible({ name: 'openai-api', baseEnv: 'OPENAI_BASE_URL', defaultBase: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' });
export const openrouterApi = openAiCompatible({ name: 'openrouter-api', baseEnv: 'OPENROUTER_BASE_URL', defaultBase: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' });
export const deepseekApi = openAiCompatible({ name: 'deepseek-api', baseEnv: 'DEEPSEEK_BASE_URL', defaultBase: 'https://api.deepseek.com', keyEnv: 'DEEPSEEK_API_KEY' });
