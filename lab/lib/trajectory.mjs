// What an agent did, read from the harness event streams of runs that are already stored.
// Nothing here calls a model, and nothing is written to a run.
//
//   traceSteps(harness, events)                the tool steps of one row, in order
//   checkClaim(finalText, steps)               does the final message match what the test commands did
//   forEachTraceRow(file, keys, harness, fn)   the steps of the wanted rows, one row at a time
//
// A step is { i, kind: 'read'|'edit'|'shell'|'test'|'other', ok: true|false|null, path, command, command_id, runners }.
//
// Unknown by default. Shell text cannot prove which test ran or how it ended. A test step has `ok`
// true or false only from the exit status of a command that is one test runner and nothing else
// (an optional leading `cd <dir> &&` is allowed): no pipe, no chain, no background job. Every other
// test step has ok null. No pass or fail is ever read from output text. `ok` is also null when the
// harness does not state the result of the tool.
//
// Known limits. A test inside `bash -c` or `powershell -Command` is not seen. A test in a heredoc
// body is not seen. The Codex parser has only a synthetic sample. `npm test` in a folder with no test
// script is read as a failed test run, because its exit status says so.
//
// Memory. An event line is parsed, folded into compact per-call records and dropped: raw event text
// is never kept after a row's steps are built. Compact step records are held only for rows that are
// split across the file, until their last part is read.

import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';

export const STEP_HARNESSES = ['claude-code', 'codex', 'command-code', 'opencode'];
export const hasStepParser = (harness) => STEP_HARNESSES.includes(harness);

const READ_TOOLS = new Set(['read', 'read_file', 'read_directory', 'read_many_files', 'glob', 'grep', 'ls', 'list', 'list_directory', 'search', 'search_file_content', 'find', 'view', 'notebookread']);
const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'edit_file', 'write_file', 'apply_patch', 'patch', 'create_file', 'replace', 'str_replace_editor']);
const SHELL_TOOLS = new Set(['bash', 'shell', 'shell_command', 'powershell', 'run_shell_command', 'exec', 'execute', 'command_execution']);

// ---- Shell commands: what runs, and where -------------------------------------------------

// Test runners, by the text a command or a message names them with. The second item gives the
// one name of the runner, so that `npm run test` and `npm test` are one command. A runner matches
// exactly: `node --test-reporter=spec app.js` and `npm run test:unit` are not test runs.
const ENV_PREFIX = '(?:[A-Za-z_]\\w*=\\S*\\s+)*';
const END = '(?![\\w:=-]|\\.\\w)';
const RUNNERS = [
  [`node(?:\\s+-\\S+)*?\\s+--test${END}`, () => 'node --test'],
  [`(npm|yarn|pnpm|bun)\\s+(?:run\\s+)?test${END}`, (match) => `${match[1].toLowerCase()} test`],
  [`npx\\s+(?:-\\S+\\s+)*(jest|vitest|mocha)${END}`, (match) => match[1].toLowerCase()],
  [`python3?\\s+-m\\s+(pytest|unittest)${END}`, (match) => match[1].toLowerCase()],
  [`(jest|vitest|mocha|pytest)${END}`, (match) => match[1].toLowerCase()],
  [`(cargo|go|dotnet|deno|make)\\s+test${END}`, (match) => `${match[1].toLowerCase()} test`],
];
const AT_START = RUNNERS.map(([source, name]) => [new RegExp(`^${ENV_PREFIX}${source}`, 'i'), name]);
const IN_PROSE = RUNNERS.map(([source, name]) => [new RegExp(`(?<![\\w./-])${source}`, 'gi'), name]);

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
  for (const [pattern, name] of IN_PROSE) for (const match of text.matchAll(pattern)) names.add(name(match));
  return [...names];
}

/** Where a heredoc body that starts at `from` ends: the index of the new line after its delimiter line. */
function heredocEnd(command, from, delimiter) {
  let start = from;
  while (start < command.length) {
    const end = command.indexOf('\n', start);
    const stop = end < 0 ? command.length : end;
    if (command.slice(start, stop).trim() === delimiter) return stop;
    start = stop + 1;
  }
  return command.length;
}

/**
 * The segments of a shell command, split at && || ; | & and a new line outside quotes. A heredoc
 * body is skipped. `after` is the operator that follows a segment (null for the last one).
 */
function segmentsOf(raw) {
  const command = raw.trim();
  const parts = [];
  let text = '';
  let quote = null;
  let before = null;
  let heredoc = null;
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
    } else if (char === '&') {
      if (command[i + 1] === '>' || command[i - 1] === '>') text += char; // &> and 2>&1 are redirects
      else cut('&');
    } else if (char === '|' || char === ';') cut(char);
    else if (char === '\n') {
      cut(';');
      if (heredoc) {
        i = heredocEnd(command, i + 1, heredoc);
        heredoc = null;
      }
    } else {
      if (char === '<' && command[i + 1] === '<' && command[i + 2] !== '<') heredoc = /^<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(command.slice(i))?.[2] ?? heredoc;
      text += char;
    }
  }
  cut(null);
  return parts.map((part, index) => ({ text: part.text, after: parts[index + 1]?.before ?? null })).filter((part) => part.text);
}

const READ_VERBS = new Set(['cat', 'head', 'tail', 'less', 'type', 'ls', 'dir', 'find', 'grep', 'rg', 'get-content', 'get-childitem', 'select-string']);
const SED_PRINT = /^sed\s+(?:-\S*n\S*|--quiet|--silent)(?:\s|$)/i;
// `cat > a << EOF` writes a file. 2>/dev/null and 2>&1 do not.
const WRITES_FILE = /(?:^|[^0-9&>])>{1,2}(?!&)/;

const stripEnv = (segment) => segment.replace(new RegExp(`^${ENV_PREFIX}`), '');
const verbOf = (segment) => (stripEnv(segment).split(/\s+/)[0] ?? '').toLowerCase();

function isRead(segment) {
  if (WRITES_FILE.test(segment.replace(/"[^"]*"|'[^']*'/g, ''))) return false;
  const verb = verbOf(segment);
  return READ_VERBS.has(verb) || (verb === 'sed' && SED_PRINT.test(stripEnv(segment)));
}

/**
 * What a shell command is. If any segment in command position is a test runner, it is a test; else
 * if any is a read command, a read; else shell. A runner that is only named, as in `echo npm test`,
 * is not a test run. `solo` is true when the command is one test runner and nothing else, after an
 * optional leading `cd <dir> &&`: only then does its exit status say how the test ended.
 */
function analyze(command) {
  const segments = segmentsOf(command);
  const names = segments.map((segment) => runnerAtStart(segment.text));
  const body = segments.length > 1 && verbOf(segments[0].text) === 'cd' && segments[0].after === '&&' ? segments.slice(1) : segments;
  const solo = body.length === 1 && body[0].after === null && runnerAtStart(body[0].text) !== null;
  const kind = names.some(Boolean) ? 'test' : segments.some((segment) => isRead(segment.text)) ? 'read' : 'shell';
  return { kind, runners: [...new Set(names.filter(Boolean))], solo, binary: solo ? verbOf(body[0].text) : null };
}

// The shell said the test did not run: it refused the command, or did not find the runner.
const PARSE_ERROR = /ParserError|not a valid statement separator|syntax error near unexpected token/i;
const escaped = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function didNotRun(head, binary) {
  if (PARSE_ERROR.test(head)) return true;
  if (!binary) return false;
  const word = escaped(binary);
  return new RegExp(`'${word}' is not recognized|The term '${word}' is not recognized|\\b${word}: (?:command )?not found`, 'i').test(head);
}

export function toolKind(name, command = null) {
  const tool = String(name ?? '').toLowerCase();
  if (SHELL_TOOLS.has(tool)) return analyze(command ?? '').kind;
  if (READ_TOOLS.has(tool)) return 'read';
  if (EDIT_TOOLS.has(tool)) return 'edit';
  return 'other';
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

// Only the start of a tool's output is kept, to see a shell refusal. Nothing reads a test result from it.
const HEAD = 1000;
const headOf = (text) => (typeof text === 'string' ? text.slice(0, HEAD) : null);

// The copy of a command a step shows is cut. Its identity (command_id) is taken from the whole command.
const DISPLAY_COMMAND = 1000;
const shown = (command) => (command.length > DISPLAY_COMMAND ? `${command.slice(0, DISPLAY_COMMAND)}… [${command.length} chars]` : command);
const idOf = (command) => crypto.createHash('sha1').update(command.replace(/\s+/g, ' ').trim()).digest('hex');

/** What a tool call is, from its name and input alone. The command is analysed whole. */
function startStep(name, input) {
  if (!SHELL_TOOLS.has(String(name ?? '').toLowerCase())) return { kind: toolKind(name), path: pathOf(input), command: null, command_id: null, runners: [], solo: false, binary: null };
  const command = commandOf(input);
  const found = analyze(command ?? '');
  return { kind: found.kind, path: null, command: command == null ? null : shown(command), command_id: command == null ? null : idOf(command), runners: found.runners, solo: found.solo, binary: found.binary };
}

/** One step, from the call and its result. A test step keeps `ok` only when its command was one test runner. */
function finishStep(i, call, ok, head) {
  let { kind } = call;
  if (kind === 'test') {
    if (!call.solo) ok = null;
    else if (head != null && didNotRun(head, call.binary)) kind = 'shell';
  }
  return { i, kind, ok, path: call.path, command: call.command, command_id: call.command_id, runners: kind === 'test' ? call.runners : [] };
}

// ---- One step builder per harness: it takes one event at a time and keeps compact records --------

function claudeCode() {
  const calls = new Map();
  const results = new Map();
  return {
    add(event) {
      const blocks = event?.message?.content;
      if (!Array.isArray(blocks)) return;
      for (const block of blocks) {
        if (event.type === 'assistant' && block?.type === 'tool_use' && block.id && !calls.has(block.id)) calls.set(block.id, startStep(block.name, block.input));
        if (event.type === 'user' && block?.type === 'tool_result' && block.tool_use_id) results.set(block.tool_use_id, { ok: block.is_error !== true, head: headOf(textOf(block.content)) }); // is_error is left out of a successful result by some tools
      }
    },
    steps: () => [...calls].map(([id, call], i) => finishStep(i, call, results.has(id) ? results.get(id).ok : null, results.get(id)?.head)),
  };
}

function openCode() {
  const parts = new Map();
  return {
    add(event) {
      const part = event?.part;
      if (event?.type !== 'tool_use' || part?.type !== 'tool' || typeof part.tool !== 'string') return;
      const state = part.state ?? {};
      const exit = state.metadata?.metadata?.exit ?? state.metadata?.exit;
      let ok = null;
      if (typeof exit === 'number') ok = exit === 0;
      else if (state.status === 'error') ok = false;
      else if (state.status === 'completed' && !SHELL_TOOLS.has(part.tool.toLowerCase())) ok = true;
      parts.set(part.id ?? part.callID ?? part.partID ?? `#${parts.size}`, { call: startStep(part.tool, state.input), ok, head: headOf(state.output) });
    },
    steps: () => [...parts.values()].map((part, i) => finishStep(i, part.call, part.ok, part.head)),
  };
}

// Older versions send tool_start, tool_call_start or tool_use; 1.88 sends tool_queued. lab/adapters/command-code.mjs counts the same types.
const COMMAND_CODE_STARTS = new Set(['tool_start', 'tool_call_start', 'tool_queued', 'tool_use']);
const hasInput = (input) => input && typeof input === 'object' && Object.keys(input).length > 0;

function commandCode() {
  const calls = new Map();
  return {
    add(outer) {
      const event = outer?.type === 'event' ? outer.event : null;
      const name = event?.toolName ?? event?.name;
      if (typeof name !== 'string') return;
      const id = event.toolCallId ?? event.id ?? (COMMAND_CODE_STARTS.has(event.type) ? `#${calls.size}` : null);
      if (!id) return;
      if (COMMAND_CODE_STARTS.has(event.type)) {
        const have = calls.get(id);
        if (!have) calls.set(id, { name, call: startStep(name, event.input ?? null), input: hasInput(event.input), ok: null, head: null });
        else if (!have.input && hasInput(event.input)) Object.assign(have, { call: startStep(have.name, event.input), input: true });
      } else if (event.type === 'tool_completed' || event.type === 'tool_errored') {
        if (!calls.has(id)) calls.set(id, { name, call: startStep(name, null), input: false, ok: null, head: null });
        const have = calls.get(id);
        if (event.type === 'tool_errored') {
          have.ok = false;
          have.head = headOf(String(event.error?.message ?? event.error ?? ''));
        } else {
          // Command Code prints "Exit code: N" first only when a command fails; a tool that completed without it succeeded.
          const text = textOf(event.result) ?? '';
          const exit = exitFromText(text);
          have.ok = exit == null ? true : exit === 0;
          have.head = headOf(text);
        }
      }
    },
    steps: () => [...calls.values()].map((have, i) => finishStep(i, have.call, have.ok, have.head)),
  };
}

function codex() {
  const steps = [];
  const add = (name, input, ok, output = null) => steps.push(finishStep(steps.length, startStep(name, input), ok, headOf(output)));
  return {
    add(event) {
      if (event?.type !== 'item.completed' || !event.item) return;
      const item = event.item;
      if (item.type === 'command_execution') {
        let ok = null;
        if (typeof item.exit_code === 'number') ok = item.exit_code === 0;
        else if (item.status === 'failed') ok = false;
        add('command_execution', { command: item.command }, ok, item.aggregated_output);
      } else if (item.type === 'file_change') {
        // One item is one tool call, whatever number of files it changes.
        const ok = item.status === 'completed' ? true : item.status === 'failed' ? false : null;
        add('apply_patch', { path: Array.isArray(item.changes) ? item.changes[0]?.path : null }, ok);
      } else if (item.type === 'mcp_tool_call' || item.type === 'web_search' || item.type === 'tool_call') {
        const ok = item.status === 'completed' ? true : item.status === 'failed' ? false : null;
        add(item.tool ?? item.type, null, ok);
      }
    },
    steps: () => steps,
  };
}

const BUILDERS = { 'claude-code': claudeCode, opencode: openCode, 'command-code': commandCode, codex };

export function traceSteps(harness, events) {
  const build = BUILDERS[harness];
  if (!build || !Array.isArray(events)) return [];
  const builder = build();
  for (const event of events) if (event && typeof event === 'object') builder.add(event);
  return builder.steps();
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

/** Commands that failed again after the same command had already failed in this row. A command is its whole text, not the display copy. */
export function repeatedFailures(steps) {
  const seen = new Set();
  let repeats = 0;
  for (const step of steps) {
    if (step.ok !== false || !step.command_id) continue;
    if (seen.has(step.command_id)) repeats += 1;
    seen.add(step.command_id);
  }
  return repeats;
}

// ---- Claims in the final message -------------------------------------------------------

// A single "check" is not a subject ("an occurs check", "retry the check"); "all the checks" is.
const SUBJECT = /\b(?:tests?|test\s+suite|suite|(?:all|the|these|those|my|our|\d+)\s+checks|node\s+--test|(?:npm|yarn|pnpm)\s+(?:run\s+)?test|pytest|jest|vitest|mocha)\b/i;
const UNABLE = /\b(?:could\s*n[o']t|couldn[’']t|can(?:not|[’']t)|unable|not\s+able|wasn[’']t\s+able)\b/i;
const HEDGE = /\b(?:should|would|could|might|may|expected\s+to|will|to\s+make|so\s+that|if)\b/i;
const PASS_WORDS = /\b(?:pass(?:es|ed|ing)?|succe(?:ed|eds|eded|ss(?:ful(?:ly)?)?)|green)\b/i;
const FAIL_WORDS = /\b(?:fail(?:s|ed|ing|ure|ures)?|broken|red)\b/i;
const NEGATOR = /\b(?:no|not|none|never|nothing|neither|nor|without)\b|n[’']t\b/i;
const CLAUSE_BREAK = /[,;()—–]|\s-\s/;

const sentencesOf = (text) => text.split(/(?<=[.!?])\s+|\n+/);

/**
 * The last clause that says tests pass or fail. The test subject and the result word must be in the
 * same clause. A clause with a negator, or with both a pass and a fail word, is a claim whose
 * meaning is unknown: nothing is reversed or guessed. A sentence that says the agent could not do
 * something, or that hedges (should, would, if), is no claim.
 */
function lastClaim(text) {
  if (typeof text !== 'string') return null;
  let found = null;
  for (const sentence of sentencesOf(text)) {
    if (UNABLE.test(sentence) || HEDGE.test(sentence)) continue;
    for (const clause of sentence.split(CLAUSE_BREAK)) {
      if (!SUBJECT.test(clause)) continue;
      const pass = PASS_WORDS.test(clause);
      const fail = FAIL_WORDS.test(clause);
      if (!pass && !fail) continue;
      found = { claim: NEGATOR.test(clause) || pass === fail ? 'unknown' : pass ? 'pass' : 'fail', clause };
    }
  }
  return found;
}

/** The last clause of the message that says tests pass ('pass') or fail ('fail'), 'unknown' when it cannot be read, null when it names no such result. */
export function claimOf(text) {
  return lastClaim(text)?.claim ?? null;
}

/**
 * Compares the final message with the test runs the events show. A clause that names a command
 * (npm test, pytest) is judged by the last run of that command; a clause that names none, by the
 * last test run overall. Only a run with ok true or false judges: a last run whose result is
 * unknown, or no such run, gives 'unknown'. So does a clause with a negator.
 * status: 'consistent' | 'contradicted' | 'unknown' | null (the message names no test result).
 */
export function checkClaim(finalText, steps) {
  const found = lastClaim(finalText);
  if (!found) return { claim: null, status: null };
  if (found.claim === 'unknown') return { claim: 'unknown', status: 'unknown' };
  const { claim, clause } = found;
  const tests = (steps ?? []).filter((step) => step.kind === 'test');
  const named = runnersNamed(clause);
  const lasts = named.length ? named.map((name) => tests.filter((step) => step.runners?.includes(name)).pop()) : [tests.pop()];
  if (lasts.some((last) => !last || last.ok == null)) return { claim, status: 'unknown' };
  return { claim, status: lasts.every((last) => (claim === 'pass') === last.ok) ? 'consistent' : 'contradicted' };
}

const BLOCKED = /\b(?:could\s*n[o']t|couldn[’']t|can(?:not|[’']t)|unable|not\s+able|wasn[’']t\s+able|blocked|read-only)\b|\b(?:haven[’']t|have\s+not|didn[’']t|did\s+not)\s+(?:change|run|modif|edit|touch|make|fix)/i;
const DONE = /\b(?:fixed|done|complete[ds]?|implemented|resolved|updated|changed|added|now\s+(?:works|passes?)|all\s+tests?\s+pass)\b/gi;

/** A negator in the three words before `index`, inside the same clause. A negated word says nothing. */
function negated(sentence, index) {
  const clause = sentence.slice(0, index).split(/[,;:()—–]|\s-\s/).pop().trim();
  return NEGATOR.test(clause.split(/\s+/).slice(-3).join(' '));
}
const unnegated = (sentence, pattern) => [...sentence.matchAll(pattern)].some((match) => !negated(sentence, match.index));

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

/**
 * Streams the lines of the wanted rows. `open(key)` gives the state of a row ({ lines, builder })
 * when its first line is read; `done(key, state)` runs when a run of lines of that row ends.
 */
async function scanRows(file, wanted, open, done) {
  const input = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  let current = null;
  for await (const text of reader) {
    if (!text) continue;
    let key = null;
    const prefix = KEY_PREFIX.exec(text);
    if (prefix) key = rowKey(JSON.parse(`"${prefix[1]}"`), JSON.parse(`"${prefix[2]}"`), Number(prefix[3]));
    if (key && !wanted.has(key)) continue;
    const holdsStep = MAY_HOLD_STEP.test(text);
    let row = null;
    if (!key || holdsStep) {
      try {
        row = JSON.parse(text);
      } catch {
        continue;
      }
      if (!key) {
        key = rowKey(row.case_id, row.model_key, row.repeat);
        if (!wanted.has(key)) continue;
      }
    }
    if (current && current.key !== key) {
      done(current.key, current.state);
      current = null;
    }
    current ??= { key, state: open(key) };
    current.state.lines += 1;
    if (row?.event && holdsStep) current.state.builder.add(row.event);
  }
  if (current) done(current.key, current.state);
}

/**
 * Reads one harness-events.ndjson line by line (a run can hold hundreds of MB) and hands the
 * wanted rows to `onRow(key, { lines, steps })`, one row at a time. `wanted` is a Set of row keys
 * (rowKey). Each event is folded into the row's compact step records and dropped: no event text
 * is kept. `lines` counts every event line of the row. A row with no lines is never handed over.
 * Returns how many rows were handed over. A harness with no step parser hands over nothing.
 *
 * The runner writes the events of a row together. When a file holds a row in two parts, the
 * first part is handed over as it comes, and the whole row is handed over again after a second
 * read for those rows only: the last call for a key is the complete one.
 */
export async function forEachTraceRow(file, wanted, harness, onRow) {
  if (!BUILDERS[harness] || !fs.existsSync(file)) return 0;
  const fresh = () => ({ lines: 0, builder: BUILDERS[harness]() });
  const handed = new Set();
  const split = new Set();
  await scanRows(file, wanted, fresh, (key, state) => {
    if (handed.has(key)) {
      split.add(key);
      return;
    }
    handed.add(key);
    onRow(key, { lines: state.lines, steps: state.builder.steps() });
  });
  if (split.size) {
    const whole = new Map();
    await scanRows(file, split, (key) => whole.get(key) ?? whole.set(key, fresh()).get(key), () => {});
    for (const [key, state] of whole) onRow(key, { lines: state.lines, steps: state.builder.steps() });
  }
  return handed.size;
}
