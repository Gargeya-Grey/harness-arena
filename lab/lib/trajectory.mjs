// What an agent did, read from the harness event streams of runs that are already stored.
// Nothing here calls a model, and nothing is written to a run.
//
//   traceSteps(harness, events)       the tool steps of one row, in order
//   checkClaim(finalText, steps)      does the final message match what the test commands did
//   forEachTraceRow(file, keys, fn)   the events of the wanted rows, one row at a time
//
// A step is { i, kind: 'read'|'edit'|'shell'|'test'|'other', ok: true|false|null, path, command }.
// An event the parser does not know gives no step. `ok` is null when the harness does not
// state the result of the tool, or when the result cannot be read from the output.

import fs from 'node:fs';
import readline from 'node:readline';

export const STEP_HARNESSES = ['claude-code', 'codex', 'command-code', 'opencode'];
export const hasStepParser = (harness) => STEP_HARNESSES.includes(harness);

const READ_TOOLS = new Set(['read', 'read_file', 'read_directory', 'read_many_files', 'glob', 'grep', 'ls', 'list', 'list_directory', 'search', 'search_file_content', 'find', 'view', 'notebookread']);
const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'edit_file', 'write_file', 'apply_patch', 'patch', 'create_file', 'replace', 'str_replace_editor']);
const SHELL_TOOLS = new Set(['bash', 'shell', 'shell_command', 'powershell', 'run_shell_command', 'exec', 'execute', 'command_execution']);

// ---- Shell commands: what runs, and where -------------------------------------------------

// Test runners by the text a command or a message names them with. The second item gives the
// one name of the runner, so that `npm run test` and `npm test` are one command.
const RUNNERS = [
  [/node\s+(?:--\S+\s+)*--test\b/i, () => 'node --test'],
  [/(npm|yarn|pnpm|bun)\s+(?:run\s+)?test\b/i, (match) => `${match[1].toLowerCase()} test`],
  [/npx\s+(jest|vitest|mocha)\b/i, (match) => match[1].toLowerCase()],
  [/python3?\s+-m\s+(pytest|unittest)\b/i, (match) => match[1].toLowerCase()],
  [/(jest|vitest|mocha|pytest)\b/i, (match) => match[1].toLowerCase()],
  [/(cargo|go|dotnet|deno|make)\s+test\b/i, (match) => `${match[1].toLowerCase()} test`],
];
const ENV_PREFIX = '(?:[A-Za-z_]\\w*=\\S*\\s+)*';
const AT_START = RUNNERS.map(([pattern, name]) => [new RegExp(`^${ENV_PREFIX}${pattern.source}`, pattern.flags), name]);

/** The name of the test runner that starts a command segment, or null. */
function runnerAtStart(segment) {
  for (const [pattern, name] of AT_START) {
    const match = pattern.exec(segment);
    if (match) return name(match);
  }
  return null;
}

/** The names of every test runner a message mentions. */
function runnersNamed(text) {
  const names = new Set();
  for (const [pattern, name] of RUNNERS) for (const match of text.matchAll(new RegExp(`\\b${pattern.source}`, `${pattern.flags}g`))) names.add(name(match));
  return [...names];
}

/**
 * The segments of a shell command, split at && || ; | and a new line outside quotes.
 * `after` is the operator that follows a segment (null for the last one).
 */
function segmentsOf(command) {
  const parts = [];
  let text = '';
  let quote = null;
  let before = null;
  const cut = (operator) => {
    parts.push({ text: text.trim(), before });
    text = '';
    before = operator;
  };
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = null;
      text += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      text += char;
    } else if (char === '&' && command[i + 1] === '&') {
      cut('&&');
      i += 1;
    } else if (char === '|' && command[i + 1] === '|') {
      cut('||');
      i += 1;
    } else if (char === '|' || char === ';' || char === '\n') cut(char === '\n' ? ';' : char);
    else text += char;
  }
  cut(null);
  const kept = parts.filter((part) => part.text);
  return kept.map((part, index) => ({ text: part.text, after: kept[index + 1]?.before ?? null }));
}

const READ_VERBS = new Set(['cat', 'head', 'tail', 'less', 'type', 'ls', 'dir', 'find', 'grep', 'rg', 'get-content', 'get-childitem', 'select-string']);
const PREFIX_VERBS = new Set(['cd', 'pushd', 'set-location', 'sl', 'export', 'set']);
const SED_PRINT = /^sed\s+(?:-\S*n\S*|--quiet|--silent)(?:\s|$)/i;

/**
 * The kind of a shell command. A test runner in command position of any segment makes it a
 * test. Else the first verb decides (after cd and export prefixes): a read command is a read,
 * so `ls -R && cat a && echo x` is a read and `echo x && cat a` is not. A runner that is only
 * named, as in `echo npm test`, is not a test run.
 */
function classifyCommand(command) {
  const segments = segmentsOf(command);
  if (segments.some((segment) => runnerAtStart(segment.text))) return 'test';
  const first = segments.find((segment) => !PREFIX_VERBS.has(verbOf(segment.text)));
  if (!first) return 'shell';
  const verb = verbOf(first.text);
  return READ_VERBS.has(verb) || (verb === 'sed' && SED_PRINT.test(first.text.replace(new RegExp(`^${ENV_PREFIX}`), ''))) ? 'read' : 'shell';
}

const verbOf = (segment) => (segment.replace(new RegExp(`^${ENV_PREFIX}`), '').split(/\s+/)[0] ?? '').toLowerCase();

/** The last test run in the command has no exit status of its own: a command follows it with | || or ;. */
function testStatusHidden(command) {
  const segments = segmentsOf(command);
  const last = segments.map((segment) => runnerAtStart(segment.text)).findLastIndex(Boolean);
  return last >= 0 && ['|', '||', ';'].includes(segments[last].after);
}

// The shell said it did not run the command: a parse error, or no such command.
const DID_NOT_RUN = /ParserError|not a valid statement separator|syntax error near unexpected token|is not recognized as (?:the name of a cmdlet|an internal or external command)|command not found/i;

export function toolKind(name, command = null) {
  const tool = String(name ?? '').toLowerCase();
  if (SHELL_TOOLS.has(tool)) return classifyCommand(command ?? '');
  if (READ_TOOLS.has(tool)) return 'read';
  if (EDIT_TOOLS.has(tool)) return 'edit';
  return 'other';
}

// ---- Test summaries in command output ----------------------------------------------------

const NODE_FAIL_LINE = /^\s*(?:ℹ|#)?\s*fail\s+(\d+)\s*$/i;
const FAILED_COUNT = /\b(\d+)\s+(?:failed|failing|failures?)\b/gi;
const isSummaryLine = (line) => NODE_FAIL_LINE.test(line) || /\b\d+\s+(?:failed|failing|failures?)\b/i.test(line);

/**
 * The result of a test run, read from its output: false when a failed count is above 0,
 * true when every failed count is 0, null when the output has no failed count.
 */
export function testSummary(text) {
  if (typeof text !== 'string') return null;
  const counts = [];
  for (const line of text.split('\n')) {
    const node = NODE_FAIL_LINE.exec(line);
    if (node) counts.push(Number(node[1]));
    for (const match of line.matchAll(FAILED_COUNT)) counts.push(Number(match[1]));
  }
  return counts.length ? Math.max(...counts) === 0 : null;
}

// ---- Paths and text of a step ------------------------------------------------------------

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
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((item) => (typeof item === 'string' ? item : item?.text ?? '')).join('') : null);

const DISPLAY_COMMAND = 1000;
const shown = (command) => (command.length > DISPLAY_COMMAND ? `${command.slice(0, DISPLAY_COMMAND)}… [${command.length} chars]` : command);

/** One step. The command is classified whole; only the copy the step keeps is cut. */
function makeStep(i, name, input, ok, output = null) {
  const command = commandOf(input);
  let kind = toolKind(name, command);
  const shell = SHELL_TOOLS.has(String(name ?? '').toLowerCase());
  if (kind === 'test' && typeof output === 'string' && DID_NOT_RUN.test(output.slice(0, 1000))) kind = 'shell';
  else if (kind === 'test' && testStatusHidden(command)) ok = testSummary(output);
  return { i, kind, ok, path: shell ? null : pathOf(input), command: shell && command != null ? shown(command) : null };
}

// ---- One parser per harness ---------------------------------------------------------------

function claudeCode(events) {
  const steps = new Map();
  const results = new Map();
  for (const event of events) {
    const blocks = event?.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (event.type === 'assistant' && block?.type === 'tool_use' && block.id && !steps.has(block.id)) steps.set(block.id, { name: block.name, input: block.input });
      if (event.type === 'user' && block?.type === 'tool_result' && block.tool_use_id) results.set(block.tool_use_id, { ok: block.is_error !== true, text: textOf(block.content) }); // is_error is left out of a successful result by some tools
    }
  }
  return [...steps].map(([id, step], i) => makeStep(i, step.name, step.input, results.has(id) ? results.get(id).ok : null, results.get(id)?.text));
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
    const exit = state.metadata?.metadata?.exit ?? state.metadata?.exit;
    let ok = null;
    if (typeof exit === 'number') ok = exit === 0;
    else if (state.status === 'error') ok = false;
    else if (state.status === 'completed' && !SHELL_TOOLS.has(part.tool.toLowerCase())) ok = true;
    return makeStep(i, part.tool, state.input, ok, typeof state.output === 'string' ? state.output : null);
  });
}

// Older versions send tool_start, tool_call_start or tool_use; 1.88 sends tool_queued. lab/adapters/command-code.mjs counts the same types.
const COMMAND_CODE_STARTS = new Set(['tool_start', 'tool_call_start', 'tool_queued', 'tool_use']);
const hasInput = (input) => input && typeof input === 'object' && Object.keys(input).length > 0;

function commandCode(events) {
  const steps = new Map();
  for (const outer of events) {
    const event = outer?.type === 'event' ? outer.event : null;
    const name = event?.toolName ?? event?.name;
    if (typeof name !== 'string') continue;
    const id = event.toolCallId ?? event.id ?? (COMMAND_CODE_STARTS.has(event.type) ? `#${steps.size}` : null);
    if (!id) continue;
    if (COMMAND_CODE_STARTS.has(event.type)) {
      const step = steps.get(id);
      if (!step) steps.set(id, { name, input: event.input ?? null, ok: null, output: null });
      else if (!hasInput(step.input) && hasInput(event.input)) step.input = event.input;
    } else if (event.type === 'tool_completed' || event.type === 'tool_errored') {
      const step = steps.get(id) ?? { name, input: null, ok: null, output: null };
      steps.set(id, step);
      if (event.type === 'tool_errored') step.ok = false;
      else {
        // Command Code prints "Exit code: N" first only when a command fails; a tool that completed without it succeeded.
        const text = textOf(event.result) ?? '';
        const exit = exitFromText(text);
        step.ok = exit == null ? true : exit === 0;
        step.output = text;
      }
    }
  }
  return [...steps.values()].map((step, i) => makeStep(i, step.name, step.input, step.ok, step.output));
}

function codex(events) {
  const steps = [];
  const add = (name, input, ok, output = null) => steps.push(makeStep(steps.length, name, input, ok, output));
  for (const event of events) {
    if (event?.type !== 'item.completed' || !event.item) continue;
    const item = event.item;
    if (item.type === 'command_execution') {
      let ok = null;
      if (typeof item.exit_code === 'number') ok = item.exit_code === 0;
      else if (item.status === 'failed') ok = false;
      add('command_execution', { command: item.command }, ok, typeof item.aggregated_output === 'string' ? item.aggregated_output : null);
    } else if (item.type === 'file_change') {
      // One item is one tool call, whatever number of files it changes.
      const ok = item.status === 'completed' ? true : item.status === 'failed' ? false : null;
      add('apply_patch', { path: Array.isArray(item.changes) ? item.changes[0]?.path : null }, ok);
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
const NO_FAILURES = /\b(?:no|0|zero|without)\s+(?:tests?\s+)?(?:fail\w*|errors?)\b/gi;
const PASS_WORDS = /\b(?:pass(?:es|ed|ing)?|succe(?:ed|eds|eded|ss(?:ful(?:ly)?)?)|green)\b/gi;
const FAIL_WORDS = /\b(?:fail(?:s|ed|ing|ure|ures)?|broken|red)\b/gi;
const NEGATOR = /\b(?:no|not|none|never|nothing|neither|nor|without)\b|n[’']t\b/i;

const sentencesOf = (text) => text.split(/(?<=[.!?])\s+|\n+/);

/** A negator in the three words before `index`, inside the same clause. A negated word says nothing. */
function negated(sentence, index) {
  const clause = sentence.slice(0, index).split(/[,;:()—–]|\s-\s/).pop().trim();
  return NEGATOR.test(clause.split(/\s+/).slice(-3).join(' '));
}
const unnegated = (sentence, pattern) => [...sentence.matchAll(pattern)].some((match) => !negated(sentence, match.index));

/** The last sentence that says tests pass or fail, and what it says; null when no sentence does. */
function claimSentence(text) {
  if (typeof text !== 'string') return null;
  let found = null;
  for (const sentence of sentencesOf(text)) {
    if (!SUBJECT.test(sentence) || UNABLE.test(sentence) || HEDGE.test(sentence)) continue;
    const cleaned = sentence.replace(NO_FAILURES, ' pass ');
    const pass = unnegated(cleaned, PASS_WORDS);
    const fail = unnegated(cleaned, FAIL_WORDS);
    if (pass !== fail) found = { claim: pass ? 'pass' : 'fail', sentence };
  }
  return found;
}

/** The last sentence of the message that says tests pass ('pass') or fail ('fail'); null when it names no such result. */
export function claimOf(text) {
  return claimSentence(text)?.claim ?? null;
}

/**
 * Compares the final message with the test commands the events show. A message that names a
 * command (npm test, pytest) is judged by the last run of that command, and by nothing else.
 * A message that names none is judged by the last test run overall.
 * status: 'consistent' | 'contradicted' | 'unknown' | null (the message names no test result).
 * Missing evidence (no such run, or a last run whose result is not known) gives 'unknown'.
 */
export function checkClaim(finalText, steps) {
  const found = claimSentence(finalText);
  if (!found) return { claim: null, status: null };
  const { claim, sentence } = found;
  const tests = (steps ?? []).filter((step) => step.kind === 'test');
  const named = runnersNamed(sentence);
  const lasts = named.length
    ? named.map((name) => tests.filter((step) => segmentsOf(step.command ?? '').some((segment) => runnerAtStart(segment.text) === name)).pop())
    : [tests.pop()];
  if (lasts.some((last) => !last || last.ok == null)) return { claim, status: 'unknown' };
  return { claim, status: lasts.every((last) => (claim === 'pass') === last.ok) ? 'consistent' : 'contradicted' };
}

const BLOCKED = /\b(?:could\s*n[o']t|couldn[’']t|can(?:not|[’']t)|unable|not\s+able|wasn[’']t\s+able|blocked|read-only)\b|\b(?:haven[’']t|have\s+not|didn[’']t|did\s+not)\s+(?:change|run|modif|edit|touch|make|fix)/i;
const DONE = /\b(?:fixed|done|complete[ds]?|implemented|resolved|updated|changed|added|now\s+(?:works|passes?)|all\s+tests?\s+pass)\b/gi;

/** The message reports finished work: it says something was done and does not say the agent was blocked. */
export function saidDone(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const sentences = sentencesOf(text);
  return !sentences.some((sentence) => BLOCKED.test(sentence)) && sentences.some((sentence) => unnegated(sentence, DONE));
}

// ---- Reading event files ---------------------------------------------------------------

export const rowKey = (caseId, modelKey, repeat) => `${caseId}|${modelKey}|${repeat}`;

const KEY_PREFIX = /^\{"case_id":"((?:[^"\\]|\\.)*)","model_key":"((?:[^"\\]|\\.)*)","repeat":(\d+)/;
// A line without one of these cannot hold a tool step in any known format; it is not parsed.
const MAY_HOLD_STEP = /tool_|command_execution|file_change|mcp_tool|web_search/;
const LONG_TEXT = 600;
// A command is classified whole, so it is never cut. Any other long text is cut to its first
// LONG_TEXT characters, plus the lines that give a test result: those sit at the end of an output.
const WHOLE_KEYS = new Set(['command', 'cmd']);

function cutText(text) {
  const summary = text.split('\n').filter(isSummaryLine).slice(-8).map((line) => line.slice(0, 200));
  return summary.length ? `${text.slice(0, LONG_TEXT)}\n[cut]\n${summary.join('\n')}` : text.slice(0, LONG_TEXT);
}

function shorten(value, whole = false) {
  if (typeof value === 'string') return whole || value.length <= LONG_TEXT ? value : cutText(value);
  if (Array.isArray(value)) return value.map((item) => shorten(item, whole));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item, WHOLE_KEYS.has(key))]));
  return value;
}

/** Streams the lines of the wanted rows. `done(row)` runs when a row's lines end; a row is { key, lines, events }. */
async function scanRows(file, wanted, done) {
  const input = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  let current = null;
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
    if (current && current.key !== key) {
      done(current);
      current = null;
    }
    current ??= { key, lines: 0, events: [] };
    current.lines += 1;
    if (row?.event && MAY_HOLD_STEP.test(line)) current.events.push(shorten(row.event));
  }
  if (current) done(current);
}

/**
 * Reads one harness-events.ndjson line by line (a run can hold hundreds of MB) and hands the
 * wanted rows to `onRow(key, { lines, events })`, one row at a time. Only the row being read is
 * held: once `onRow` returns, the row is dropped. `wanted` is a Set of row keys (rowKey).
 * `lines` counts every event line of the row; `events` holds only the ones that may carry a tool step.
 * A row with no lines is never handed over. Returns how many rows were handed over.
 *
 * The runner writes the events of a row together. When a file holds a row in two parts, the
 * first part is handed over as it comes, and the whole row is handed over again after a second
 * read for those rows only: the last call for a key is the complete one.
 */
export async function forEachTraceRow(file, wanted, onRow) {
  if (!fs.existsSync(file)) return 0;
  const handed = new Set();
  const split = new Set();
  await scanRows(file, wanted, (row) => {
    if (handed.has(row.key)) {
      split.add(row.key);
      return;
    }
    handed.add(row.key);
    onRow(row.key, { lines: row.lines, events: row.events });
  });
  if (split.size) {
    const whole = new Map();
    await scanRows(file, split, (row) => {
      const have = whole.get(row.key);
      if (have) {
        have.lines += row.lines;
        have.events.push(...row.events);
      } else whole.set(row.key, row);
    });
    for (const row of whole.values()) onRow(row.key, { lines: row.lines, events: row.events });
  }
  return handed.size;
}
