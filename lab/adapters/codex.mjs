// OpenAI Codex CLI: `codex exec --json`, prompt on stdin. Read-only sandbox, or
// workspace-write for agent tasks (access: edit).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineCli } from './cli.mjs';
import { jsonLines, stderrError, stderrTail } from './process.mjs';

const BIN = 'codex';
const TOOL_ITEMS = new Set(['command_execution', 'mcp_tool_call', 'web_search', 'file_change', 'tool_call']);
const BENCHMARK_SCOPE = 'This is a controlled Model Lab benchmark. Work only on the supplied task in the current workspace. Do not read personal memory, global skills, instructions outside the workspace, other repositories, hidden checks or saved benchmark results. Do not use MCP servers or delegate to other agents. Follow the supplied task\'s tool restrictions. When the task forbids tools, do not call tools, execute code or create files. Otherwise use built-in local tools only as the task permits. These benchmark instructions do not change the tool permission or sandbox policies.';
const WINDOWS_ISOLATION = [
  '--ignore-user-config', '--ignore-rules',
  '-c', 'project_doc_max_bytes=0',
  '-c', 'skills.include_instructions=false',
  '-c', 'features.memories=false', '-c', 'features.plugins=false', '-c', 'features.apps=false',
  '-c', 'features.hooks=false', '-c', 'features.skill_search=false',
  '-c', `developer_instructions=${JSON.stringify(BENCHMARK_SCOPE)}`,
];

function installedWindowsSandbox(env = {}, access) {
  const inherited = { ...process.env, ...env };
  const homeKey = Object.keys(inherited).find((key) => key.toUpperCase() === 'CODEX_HOME');
  const codexHome = homeKey && inherited[homeKey] ? inherited[homeKey] : path.join(os.homedir(), '.codex');
  let text;
  try { text = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'); }
  catch { throw new Error('Windows Codex isolation needs an existing config.toml with [windows].sandbox set to elevated or unelevated. No model call was made.'); }
  let section = '';
  let backend = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (heading) { section = heading[1].trim(); continue; }
    const key = section === 'windows' ? 'sandbox' : section === '' ? 'windows\\.sandbox' : null;
    if (!key) continue;
    const setting = new RegExp(`^\\s*${key}\\s*=\\s*(['"])(elevated|unelevated)\\1\\s*(?:#.*)?$`).exec(line);
    if (setting) backend = setting[2];
  }
  if (!backend) throw new Error('Windows Codex isolation could not verify the installed sandbox backend. Set [windows].sandbox to elevated or unelevated in the installed config. No model call was made.');
  if (backend === 'elevated' && access === 'edit') {
    for (const rel of ['.sandbox/setup_marker.json', '.sandbox-secrets/sandbox_users.json']) {
      try { if (fs.statSync(path.join(codexHome, rel)).isFile()) continue; } catch {}
      throw new Error('Windows Codex isolation needs an already initialized elevated sandbox. Complete the installed sandbox setup once outside the benchmark. No model call was made.');
    }
  }
  return backend;
}

const adapter = defineCli({
  name: 'codex',
  bin: BIN,
  supportsEffort: true,
  edit: { args: ['-s', 'workspace-write'], note: 'Codex sandbox workspace-write: writes inside the call folder and, by Codex defaults, the temp folder. Windows edit calls reuse the installed home and its configured sandbox backend.' },
  stdin: ({ prompt }) => prompt,
  isolation: process.platform === 'win32' ? {
    args: WINDOWS_ISOLATION,
    clearEnv: ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_TOOL_CALL_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'CODEX_SECURITY_SCAN_ROOT', 'CODEX_CI'],
    note: 'Reuses the installed CODEX_HOME and its verified Windows sandbox backend; skips user config and execpolicy rules, personal memory, skill catalog, plugins, apps and hooks. The global AGENTS.md instruction file still loads, so user setup is only partly kept out. A benchmark-only developer instruction forbids external context reads; this is instruction isolation in part, not filesystem read isolation.',
  } : {
    home: { files: ['.codex/auth.json'], env: (home) => ({ CODEX_HOME: path.join(home, '.codex') }) },
    note: 'Runs with an empty CODEX_HOME in a temp home that holds only the sign-in file. Skips config.toml, AGENTS.md, skills and MCP servers.',
  },

  args({ model, effort, cwd, persist, access, isolated, tempHome, env }) {
    if (process.platform === 'win32' && access === 'edit' && tempHome) {
      throw new Error('Isolated Codex edit calls on Windows would initialize an elevated sandbox in each temporary home and request repeated Windows approval. Use a separate experiment with user_config: loaded to reuse the installed sandbox. No model call was made.');
    }
    const args = [...(isolated ? ['--no-daemon'] : []), 'exec', '--json', '--skip-git-repo-check', ...(access === 'edit' ? [] : ['-s', 'read-only']), '--color', 'never', '-m', model];
    if (process.platform === 'win32' && isolated) args.push('-c', `windows.sandbox="${installedWindowsSandbox(env, access)}"`);
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

// This root option precedes `exec`; the recorded isolation includes it, while
// isolation.flags contains only options appended after the subcommand.
if (process.platform === 'win32') adapter.isolation.args.unshift('--no-daemon');
export default adapter;
