// Harnesses declared in configs/harnesses.yaml: connect a new CLI with no code.
// The entry says how to call the CLI and where its output keeps the answer;
// everything else (spawning, isolation record, run record) is shared.

import { defineCli } from './cli.mjs';
import { jsonLines, lastJsonObject, stderrError, stderrTail } from './process.mjs';

const OUTPUTS = new Set(['text', 'json', 'jsonl']);
const FIELDS = ['text', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'session_id', 'error', 'cost_usd'];

function pick(value, dotted) {
  if (!dotted) return undefined;
  return String(dotted)
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), value);
}

function fill(template, values) {
  return String(template).replace(/\{(model|effort|prompt|cwd)\}/g, (match, key) => String(values[key] ?? ''));
}

const asNumber = (value) => (typeof value === 'number' ? value : null);

/** Problems in one declared entry; an empty list means it can be used. */
export function checkDeclared(name, entry, builtIn) {
  const problems = [];
  if (builtIn.has(name)) problems.push(`"${name}" is a built-in harness; pick another name`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) problems.push(`"${name}" should be lowercase letters, digits and dashes`);
  if (!entry || typeof entry !== 'object') return [...problems, 'needs a map of settings'];
  if (typeof entry.bin !== 'string' || !entry.bin) problems.push('needs "bin", the command name on PATH');
  const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
  // Quote numbers in YAML lists ("3", not 3): every argument is a string.
  if (!strings(entry.args)) return [...problems, 'needs "args", a list of strings'];
  for (const key of ['version_args', 'effort_args', 'isolation_args', 'edit_args']) {
    if (entry[key] != null && !strings(entry[key])) problems.push(`${key} must be a list of strings`);
  }
  const output = entry.output ?? 'text';
  if (!OUTPUTS.has(output)) problems.push(`output must be one of ${[...OUTPUTS].join(', ')}`);
  const hasPrompt = entry.args.some((item) => item.includes('{prompt}'));
  if (entry.stdin && hasPrompt) problems.push('use "{prompt}" in args or stdin: true, not both');
  if (!entry.stdin && !hasPrompt) problems.push('pass the prompt: put "{prompt}" in args or set stdin: true');
  if (entry.args.some((item) => item.includes('{prompt}') && item !== '{prompt}')) problems.push('"{prompt}" must be a whole argument, never part of one');
  for (const key of ['version_args', 'effort_args', 'isolation_args', 'edit_args']) {
    if (strings(entry[key]) && entry[key].some((item) => item.includes('{prompt}'))) problems.push(`${key} cannot hold "{prompt}"; only args can`);
  }
  if (entry.result != null && (typeof entry.result !== 'object' || Array.isArray(entry.result))) problems.push('result must be a map');
  if (output !== 'text' && !entry.result?.text) problems.push('json and jsonl output need result.text, the path to the answer');
  for (const key of Object.keys(entry.result || {})) {
    if (key !== 'where' && !FIELDS.includes(key)) problems.push(`result.${key} is unknown; use ${FIELDS.join(', ')}`);
  }
  return problems;
}

export function declaredAdapter(name, entry) {
  const output = entry.output ?? 'text';
  const result = entry.result || {};
  return defineCli({
    name,
    bin: entry.bin,
    versionArgs: entry.version_args,
    supportsEffort: Array.isArray(entry.effort_args),
    declared: true,
    stdin: entry.stdin ? ({ prompt }) => prompt : undefined,
    edit: entry.edit_args ? { args: entry.edit_args, note: entry.edit_note || 'Declared in configs/harnesses.yaml.' } : undefined,
    isolation: entry.isolation_args
      ? { args: entry.isolation_args, note: entry.isolation_note || 'Declared in configs/harnesses.yaml.' }
      : undefined,
    args(ctx) {
      const args = entry.args.map((item) => fill(item, ctx));
      if (ctx.effort && entry.effort_args) args.push(...entry.effort_args.map((item) => fill(item, ctx)));
      return args;
    },
    parse({ stdout, stderr, code }) {
      let node = null;
      let events = [];
      if (output === 'jsonl') {
        events = jsonLines(stdout);
        const where = Object.entries(result.where || {});
        node = [...events].reverse().find((event) => where.every(([key, want]) => pick(event, key) === want)) || null;
      } else if (output === 'json') {
        node = lastJsonObject(stdout);
        events = node ? [node] : [];
      }
      const raw = output === 'text' ? stdout.trim() : pick(node, result.text);
      const failure = node ? pick(node, result.error) : undefined;
      let error = null;
      if (failure) error = { type: 'harness_error', message: String(typeof failure === 'string' ? failure : JSON.stringify(failure)) };
      else if (raw == null || raw === '' || code !== 0) {
        error = stderrError(stderr) || { type: 'no_result', message: stderrTail(stderr) || `${entry.bin} exited with code ${code} and no answer` };
      }
      return {
        text: error ? null : String(raw),
        finish_reason: error ? null : 'end_turn',
        usage: {
          input_tokens: asNumber(pick(node, result.input_tokens)),
          output_tokens: asNumber(pick(node, result.output_tokens)),
          cache_read_tokens: asNumber(pick(node, result.cache_read_tokens)),
          cache_write_tokens: asNumber(pick(node, result.cache_write_tokens)),
        },
        harness_duration_ms: null,
        model_request_duration_ms: null,
        tool_calls: 0,
        skills_used: [],
        session_id: pick(node, result.session_id) ?? null,
        model_reported: null,
        turn_count: null,
        harness_cost_usd: asNumber(pick(node, result.cost_usd)),
        events,
        error,
        extra: {},
      };
    },
  });
}
