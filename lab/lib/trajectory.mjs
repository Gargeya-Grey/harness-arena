// What an agent did, read from the harness event streams of runs that are already stored.
// Nothing here calls a model, and nothing is written to a run.
//
//   traceSteps(harness, events)  the tool steps of one row, in order
//   checkClaim(finalText, steps) does the final message match what the last test command did
//   readTraceEvents(file, keys)  the events of the wanted rows, one line at a time
//
// A step is { i, kind: 'read'|'edit'|'shell'|'test'|'other', ok: true|false|null, path, command }.
// An event the parser does not know gives no step. `ok` is null when the harness does not
// state the result of the tool.

import fs from 'node:fs';
import readline from 'node:readline';

export const STEP_HARNESSES = ['claude-code', 'codex', 'command-code', 'opencode'];
export const hasStepParser = (harness) => STEP_HARNESSES.includes(harness);

const READ_TOOLS = new Set(['read', 'read_file', 'read_directory', 'read_many_files', 'glob', 'grep', 'ls', 'list', 'list_directory', 'search', 'search_file_content', 'find', 'view', 'notebookread']);
const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'edit_file', 'write_file', 'apply_patch', 'patch', 'create_file', 'replace', 'str_replace_editor']);
const SHELL_TOOLS = new Set(['bash', 'shell', 'shell_command', 'powershell', 'run_shell_command', 'exec', 'execute', 'command_execution']);

const TEST_COMMAND = /\b(?:node\s+(?:--\S+\s+)*--test|(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?test|npx\s+(?:jest|vitest|mocha)|jest|vitest|mocha|pytest|python3?\s+-m\s+(?:pytest|unittest)|cargo\s+test|go\s+test|dotnet\s+test|deno\s+test|make\s+test)\b/i;

export function toolKind(name, command = null) {
  const tool = String(name ?? '').toLowerCase();
  if (SHELL_TOOLS.has(tool)) return TEST_COMMAND.test(command ?? '') ? 'test' : 'shell';
  if (READ_TOOLS.has(tool)) return 'read';
  if (EDIT_TOOLS.has(tool)) return 'edit';
  return 'other';
}

const HOME_PATH = /(?:[A-Za-z]:)?[\\/]+(?:Users|home)[\\/]+[^\\/\s"'`]+|~[\\/]AppData[\\/]Local[\\/]Temp[\\/]model-lab-[A-Za-z0-9]+/g;

/** Text without a home path: the call folder becomes <workdir>, a user folder becomes ~. */
export function scrub(text) {
  return String(text).replace(HOME_PATH, (match) => (/model-lab-/.test(match) ? '<workdir>' : '~'));
}

/** A path as the agent saw it, relative to its call folder when it is inside, else only the file name. */
export function cleanPath(value) {
  if (typeof value !== 'string' || !value) return null;
  const slashes = value.replace(/\\/g, '/');
  const inside = /(?:model-lab-[A-Za-z0-9]+|<workdir>)(?:\/(.*))?$/.exec(slashes);
  if (inside) return inside[1] || '.';
  if (/^(?:[A-Za-z]:\/|\/|~)/.test(slashes)) return `<outside>/${slashes.split('/').filter(Boolean).pop() ?? ''}`;
  return slashes;
}

const pathOf = (input) => cleanPath(input?.file_path ?? input?.path ?? input?.filePath ?? input?.notebook_path ?? null);
const commandOf = (input) => {
  const command = input?.command ?? input?.cmd ?? null;
  return typeof command === 'string' ? scrub(command) : Array.isArray(command) ? scrub(command.join(' ')) : null;
};
const exitFromText = (text) => {
  const match = /^\s*Exit code:?\s+(-?\d+)/i.exec(String(text ?? ''));
  return match ? Number(match[1]) : null;
};

function makeStep(i, name, input, ok) {
  const command = commandOf(input);
  const kind = toolKind(name, command);
  return { i, kind, ok, path: kind === 'shell' || kind === 'test' ? null : pathOf(input), command: kind === 'shell' || kind === 'test' ? command : null };
}

function claudeCode(events) {
  const steps = new Map();
  const results = new Map();
  for (const event of events) {
    const blocks = event?.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (event.type === 'assistant' && block?.type === 'tool_use' && block.id && !steps.has(block.id)) steps.set(block.id, { name: block.name, input: block.input });
      if (event.type === 'user' && block?.type === 'tool_result' && block.tool_use_id) results.set(block.tool_use_id, block.is_error !== true); // is_error is left out of a successful result by some tools
    }
  }
  return [...steps].map(([id, step], i) => makeStep(i, step.name, step.input, results.has(id) ? results.get(id) : null));
}

function openCode(events) {
  const parts = new Map();
  for (const event of events) {
    const part = event?.part;
    if (event?.type !== 'tool_use' || part?.type !== 'tool' || typeof part.tool !== 'string') continue;
    parts.set(part.id ?? part.callID ?? part.partID ?? `#${parts.size}`, part);
  }
  return [...parts.values()].map((part, i) => {
    const state = part.state ?? {};
    const kind = toolKind(part.tool, commandOf(state.input));
    const exit = state.metadata?.metadata?.exit ?? state.metadata?.exit;
    let ok = null;
    if (typeof exit === 'number') ok = exit === 0;
    else if (state.status === 'error') ok = false;
    else if (state.status === 'completed' && kind !== 'shell' && kind !== 'test') ok = true;
    return makeStep(i, part.tool, state.input, ok);
  });
}

function commandCode(events) {
  const steps = new Map();
  for (const outer of events) {
    const event = outer?.type === 'event' ? outer.event : null;
    const id = event?.toolCallId;
    if (!id || typeof event.toolName !== 'string') continue;
    if (event.type === 'tool_queued' && !steps.has(id)) steps.set(id, { name: event.toolName, input: event.input, ok: null });
    else if (event.type === 'tool_completed' || event.type === 'tool_errored') {
      const step = steps.get(id) ?? { name: event.toolName, input: null, ok: null };
      steps.set(id, step);
      if (event.type === 'tool_errored') step.ok = false;
      else {
        // Command Code prints "Exit code: N" first only when a command fails; a tool that completed without it succeeded.
        const text = Array.isArray(event.result) ? event.result.map((item) => item?.text ?? '').join('') : '';
        const exit = exitFromText(text);
        step.ok = exit == null ? true : exit === 0;
      }
    }
  }
  return [...steps.values()].map((step, i) => makeStep(i, step.name, step.input, step.ok));
}

function codex(events) {
  const steps = [];
  const add = (name, input, ok) => steps.push(makeStep(steps.length, name, input, ok));
  for (const event of events) {
    if (event?.type !== 'item.completed' || !event.item) continue;
    const item = event.item;
    if (item.type === 'command_execution') {
      let ok = null;
      if (typeof item.exit_code === 'number') ok = item.exit_code === 0;
      else if (item.status === 'failed') ok = false;
      add('command_execution', { command: item.command }, ok);
    } else if (item.type === 'file_change') {
      const ok = item.status === 'completed' ? true : item.status === 'failed' ? false : null;
      for (const change of Array.isArray(item.changes) ? item.changes : [{}]) add('apply_patch', { path: change.path }, ok);
    } else if (item.type === 'mcp_tool_call' || item.type === 'web_search' || item.type === 'tool_call') {
      const ok = item.status === 'completed' ? true : item.status === 'failed' ? false : null;
      add(item.tool ?? item.type, null, ok);
    }
  }
  return steps;
}

const PARSERS = { 'claude-code': claudeCode, opencode: openCode, 'command-code': commandCode, codex };

export function traceSteps(harness, events) {
  const parse = PARSERS[harness];
  return parse && Array.isArray(events) ? parse(events.filter((event) => event && typeof event === 'object')) : [];
}

// ---- Process facts of one row ----------------------------------------------------------

export function median(values) {
  const sorted = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Reads before the first edit, as a share of all reads. Null without a read or without an edit. */
export function readShareBeforeFirstEdit(steps) {
  const firstEdit = steps.findIndex((step) => step.kind === 'edit');
  const reads = steps.filter((step) => step.kind === 'read');
  if (firstEdit < 0 || !reads.length) return null;
  return steps.slice(0, firstEdit).filter((step) => step.kind === 'read').length / reads.length;
}

/** Commands that failed again after the same command had already failed in this row. */
export function repeatedFailures(steps) {
  const seen = new Set();
  let repeats = 0;
  for (const step of steps) {
    if (step.ok !== false || !step.command) continue;
    const key = step.command.replace(/\s+/g, ' ').trim();
    if (seen.has(key)) repeats += 1;
    seen.add(key);
  }
  return repeats;
}

// ---- Claims in the final message -------------------------------------------------------

const SUBJECT = /\b(?:tests?|test\s+suite|suite|checks?|node\s+--test|(?:npm|yarn|pnpm)\s+(?:run\s+)?test|pytest|jest|vitest|mocha)\b/i;
const UNABLE = /\b(?:could\s*n[o']t|couldn[’']t|can(?:not|[’']t)|unable|not\s+able|haven[’']t|have\s+not|hasn[’']t|didn[’']t|did\s+not|never|wasn[’']t\s+able)\b/i;
const HEDGE = /\b(?:should|would|could|might|may|expected\s+to|will|to\s+make|so\s+that|if)\b/i;
const NO_FAILURES = /\b(?:no|0|zero|without)\s+(?:test\s+)?(?:fail\w*|errors?)\b/gi;
const PASS_WORDS = /\b(?:pass(?:es|ed|ing)?|succe(?:ed|eds|eded|ss(?:ful(?:ly)?)?)|green)\b/i;
const FAIL_WORDS = /\b(?:fail(?:s|ed|ing|ure|ures)?|broken|red)\b/i;

/** The last sentence of the message that says tests pass ('pass') or fail ('fail'); null when it names no such result. */
export function claimOf(text) {
  if (typeof text !== 'string') return null;
  let claim = null;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!SUBJECT.test(sentence) || UNABLE.test(sentence) || HEDGE.test(sentence)) continue;
    const cleaned = sentence.replace(NO_FAILURES, ' pass ');
    const pass = PASS_WORDS.test(cleaned);
    const fail = FAIL_WORDS.test(cleaned);
    if (pass !== fail) claim = pass ? 'pass' : 'fail';
  }
  return claim;
}

/**
 * Compares the final message with the last test command the events show.
 * status: 'consistent' | 'contradicted' | 'unknown' | null (the message names no test result).
 * Missing evidence (no test step, or one whose result the harness does not state) gives 'unknown'.
 */
export function checkClaim(finalText, steps) {
  const claim = claimOf(finalText);
  if (!claim) return { claim: null, status: null };
  const last = (steps ?? []).filter((step) => step.kind === 'test' && step.ok !== null).pop();
  if (!last) return { claim, status: 'unknown' };
  return { claim, status: (claim === 'pass') === last.ok ? 'consistent' : 'contradicted' };
}

const BLOCKED = /\b(?:could\s*n[o']t|couldn[’']t|can(?:not|[’']t)|unable|not\s+able|wasn[’']t\s+able|blocked|read-only)\b|\b(?:haven[’']t|have\s+not|didn[’']t|did\s+not)\s+(?:change|run|modif|edit|touch|make|fix)/i;
const DONE = /\b(?:fixed|done|complete[ds]?|implemented|resolved|updated|changed|added|now\s+(?:works|passes?)|all\s+tests?\s+pass)\b/i;

/** The message reports finished work: it says something was done and does not say the agent was blocked. */
export function saidDone(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return DONE.test(text) && !text.split(/(?<=[.!?])\s+|\n+/).some((sentence) => BLOCKED.test(sentence));
}

// ---- Reading event files ---------------------------------------------------------------

export const rowKey = (caseId, modelKey, repeat) => `${caseId}|${modelKey}|${repeat}`;

const KEY_PREFIX = /^\{"case_id":"((?:[^"\\]|\\.)*)","model_key":"((?:[^"\\]|\\.)*)","repeat":(\d+)/;
// A line without one of these cannot hold a tool step in any known format; it is not parsed.
const MAY_HOLD_STEP = /tool_|command_execution|file_change|mcp_tool|web_search/;
const LONG_TEXT = 600;

function shorten(value) {
  if (typeof value === 'string') return value.length > LONG_TEXT ? value.slice(0, LONG_TEXT) : value;
  if (Array.isArray(value)) return value.map(shorten);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item)]));
  return value;
}

/**
 * Reads one harness-events.ndjson line by line (a run can hold hundreds of MB).
 * `wanted` is a Set of row keys (rowKey). Returns Map key -> { lines, events }:
 * `lines` counts every event line of the row, `events` holds only the ones that may carry a
 * tool step, with long text cut short. A row with no lines is not in the map.
 */
export async function readTraceEvents(file, wanted) {
  const rows = new Map();
  if (!fs.existsSync(file)) return rows;
  const input = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line) continue;
    let key = null;
    const prefix = KEY_PREFIX.exec(line);
    if (prefix) key = rowKey(JSON.parse(`"${prefix[1]}"`), JSON.parse(`"${prefix[2]}"`), Number(prefix[3]));
    if (key && !wanted.has(key)) continue;
    const needsParse = !key || MAY_HOLD_STEP.test(line);
    let row = null;
    if (needsParse) {
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (!key) {
        key = rowKey(row.case_id, row.model_key, row.repeat);
        if (!wanted.has(key)) continue;
      }
    }
    if (!rows.has(key)) rows.set(key, { lines: 0, events: [] });
    const entry = rows.get(key);
    entry.lines += 1;
    if (row?.event && MAY_HOLD_STEP.test(line)) entry.events.push(shorten(row.event));
  }
  return rows;
}
