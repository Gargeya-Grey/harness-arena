// node lab trace: what the stored attempts did, and what the output cost per solved task.
// It reads the rows that count (closed, ledger-matched, scored runs), the same rows
// `node lab ladder` counts, and the harness event stream of each run. It computes
// everything now; it stores nothing in a run and calls no model.

import path from 'node:path';
import { countedRows, buildState } from '../lib/state.mjs';
import { findRunDir } from '../lib/repo.mjs';
import { ladderCommand } from './ladder.mjs';
import { checkClaim, forEachTraceRow, hasStepParser, median, readShareBeforeFirstEdit, repeatedFailures, rowKey, saidDone, scrub, traceSteps } from '../lib/trajectory.mjs';

const EPS = 1e-9;
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const round = (value, digits = 3) => (value == null ? null : Number(value.toFixed(digits)));

/** What one row did, from its steps. steps is null when there is nothing to read (no events, or no parser). */
function summarize(steps) {
  if (!steps) return null;
  const count = (kind) => steps.filter((step) => step.kind === kind).length;
  return {
    tool_calls: steps.length,
    reads: count('read'),
    edits: count('edit'),
    shell: count('shell'),
    tests: count('test'),
    failed: steps.filter((step) => step.ok === false).length,
    read_share_before_first_edit: readShareBeforeFirstEdit(steps),
    repeated_failing_commands: repeatedFailures(steps),
  };
}

function perConfig(configId, label, rows, solvedBy) {
  const tools = rows.filter((row) => row.process);
  const shares = tools.map((row) => row.process.read_share_before_first_edit).filter((value) => value != null);
  const claims = { consistent: 0, contradicted: 0, unknown: 0 };
  for (const row of rows) if (row.claim?.status) claims[row.claim.status] += 1;
  const tokens = rows.map((row) => row.output_tokens).filter((value) => value != null);
  const agentRows = rows.filter((row) => row.kind === 'agent');
  // A failed check needs a check that ran. A row whose check did not run (no workspace was stored) is counted apart.
  const saidDoneRows = agentRows.filter((row) => row.said_done);
  return {
    config_id: configId,
    label,
    rows: rows.length,
    rows_with_events: rows.filter((row) => row.events === 'present').length,
    rows_missing_events: rows.filter((row) => row.events === 'missing').length,
    rows_without_parser: rows.filter((row) => row.events === 'no parser').length,
    tool_calls: { total: tools.length ? tools.reduce((sum, row) => sum + row.process.tool_calls, 0) : null, median_per_row: median(tools.map((row) => row.process.tool_calls)), rows: tools.length },
    tests_run: { total: tools.length ? tools.reduce((sum, row) => sum + row.process.tests, 0) : null, rows_with_a_test: tools.filter((row) => row.process.tests > 0).length },
    reads_before_first_edit: { share: round(mean(shares)), rows: shares.length },
    repeated_failing_commands: tools.length ? tools.reduce((sum, row) => sum + row.process.repeated_failing_commands, 0) : null,
    output_tokens: { median: median(tokens), rows: tokens.length },
    claims: { ...claims, rows_checked: agentRows.length },
    said_done_check_failed: { count: saidDoneRows.filter((row) => row.check_ran && row.value < 1 - EPS).length, rows_checked: agentRows.length },
    said_done_check_not_run: { count: saidDoneRows.filter((row) => !row.check_ran).length, rows_checked: agentRows.length },
    tasks_solved: solvedBy.size,
  };
}

/**
 * Median output tokens per solved task, on the tasks every given configuration solved.
 * A task with a repeat that has no token value has no cost: it is left out, and counted in left_out_no_tokens.
 */
function sharedSolved(tasksByConfig, ids) {
  const solvedByAll = [...tasksByConfig.get(ids[0]).keys()].filter((caseId) => ids.every((id) => tasksByConfig.get(id).get(caseId)?.solved)).sort();
  const shared = solvedByAll.filter((caseId) => ids.every((id) => tasksByConfig.get(id).get(caseId).tokens != null));
  return { tasks: shared.length, left_out_no_tokens: solvedByAll.length - shared.length, medians: Object.fromEntries(ids.map((id) => [id, median(shared.map((caseId) => tasksByConfig.get(id).get(caseId).tokens))])) };
}

/** Did the hidden check run for this row? Only a quality score that records tests tells it: an error or no score means it did not. */
function checkRan(row) {
  const details = row.scores?.find((score) => score.dimension === 'quality')?.details;
  return Boolean(details) && !details.error && Number(details.total_tests) > 0;
}

export async function buildTrace(root, { suite = null, suiteVersions = null, runs = null, harness = null, models = null } = {}) {
  const report = ladderCommand(root, { suite, suiteVersions, runs, log: () => {} });
  const state = buildState(root, { validate: false });
  const runSet = (() => {
    if (!runs) return null;
    const ids = new Set();
    for (const ref of runs) {
      const matches = state.runs.map((run) => run.run_id).filter((id) => id === ref || id.includes(ref));
      for (const id of matches.includes(ref) ? [ref] : matches) ids.add(id);
    }
    return ids;
  })();
  const versionOf = new Map(report.versions.map((item) => [item.suite, item.version]));
  const runOf = new Map(state.runs.map((run) => [run.run_id, run]));
  const kindOf = new Map(report.cases.map((entry) => [entry.case_id, entry.kind]));
  const counted = new Set(report.cases.flatMap((entry) => entry.per_config.map((item) => `${item.config_id}|${entry.case_id}`)));
  const wantConfig = (id) => (!models || models.includes(state.configs[id]?.model_key)) && (!harness || state.configs[id]?.harness?.name === harness || state.configs[id]?.harness === harness);
  // The scope of the ladder report: only the rows of a context that has a quality evaluator. A format-only run
  // of the same configuration and case has error rows that countedRows would count as failed.
  const withQuality = new Set((state.contexts || []).filter((ctx) => (ctx.evaluators || []).some((item) => item.dimension === 'quality')).map((ctx) => ctx.key));

  const picked = state.observations.filter((row) => {
    const run = runOf.get(row.run_id);
    return row.trusted !== false && run && withQuality.has(row.context_key) && String(run.suite?.version) === String(versionOf.get(run.suite?.id))
      && (!runSet || runSet.has(row.run_id)) && counted.has(`${row.config_id}|${row.case_id}`) && wantConfig(row.config_id) && countedRows([row], true).length === 1;
  });

  const rows = [];
  const byRun = new Map();
  for (const row of picked) {
    if (!byRun.has(row.run_id)) byRun.set(row.run_id, []);
    byRun.get(row.run_id).push(row);
  }
  for (const [runId, list] of byRun) {
    const name = runOf.get(runId).harness?.name ?? null;
    const parser = hasStepParser(name);
    const dir = findRunDir(root, runId);
    const byKey = new Map(list.map((row) => [rowKey(row.case_id, row.model_key, row.repeat), row]));
    // Each row is read, summarized and dropped before the next one: the steps of a row are not kept.
    const read = new Map();
    if (parser && dir) {
      await forEachTraceRow(path.join(dir, 'harness-events.ndjson'), new Set(byKey.keys()), (key, entry) => {
        const row = byKey.get(key);
        const steps = traceSteps(name, entry.events);
        // The claim check is for agent tasks, where the message can name a command result.
        read.set(key, { process: summarize(steps), claim: kindOf.get(row.case_id) === 'agent' ? checkClaim(row.response?.text, steps) : null });
      });
    }
    for (const row of list) {
      const found = read.get(rowKey(row.case_id, row.model_key, row.repeat));
      const kind = kindOf.get(row.case_id);
      const state_ = !parser ? 'no parser' : found ? 'present' : 'missing';
      const text = row.response?.text;
      rows.push({
        run_id: runId,
        case_id: row.case_id,
        config_id: row.config_id,
        repeat: row.repeat,
        kind,
        harness: name,
        events: state_,
        process: found?.process ?? null,
        claim: kind !== 'agent' ? null : found ? found.claim : checkClaim(text, []),
        said_done: kind === 'agent' && saidDone(text),
        check_ran: kind === 'agent' ? checkRan(row) : null,
        value: row.quality ?? 0,
        output_tokens: typeof row.usage?.output_tokens === 'number' ? row.usage.output_tokens : null,
      });
    }
  }

  const order = report.configs.map((config) => config.config_id).filter(wantConfig);
  const rowsByConfig = new Map(order.map((id) => [id, rows.filter((row) => row.config_id === id)]));
  const tasksByConfig = new Map();
  for (const id of order) {
    const tasks = new Map();
    for (const entry of report.cases) {
      const own = entry.per_config.find((item) => item.config_id === id);
      if (!own) continue;
      const ownRows = (rowsByConfig.get(id) || []).filter((row) => row.case_id === entry.case_id);
      // A task has a cost only when every one of its repeats has a token value.
      tasks.set(entry.case_id, { solved: own.solved, tokens: ownRows.length && ownRows.every((row) => row.output_tokens != null) ? mean(ownRows.map((row) => row.output_tokens)) : null });
    }
    tasksByConfig.set(id, tasks);
  }
  const configs = order.map((id) => perConfig(id, state.configs[id]?.short_label ?? id, rowsByConfig.get(id), [...tasksByConfig.get(id)].filter(([, task]) => task.solved)));
  const pairs = [];
  for (let a = 0; a < order.length; a += 1) {
    for (let b = a + 1; b < order.length; b += 1) {
      const shared = sharedSolved(tasksByConfig, [order[a], order[b]]);
      if (shared.tasks || shared.left_out_no_tokens) pairs.push({ a: order[a], b: order[b], tasks: shared.tasks, left_out_no_tokens: shared.left_out_no_tokens, median_output_tokens: shared.medians });
    }
  }
  const all = order.length > 1 ? sharedSolved(tasksByConfig, order) : null;
  return { filters: { suite, suite_versions: suiteVersions, runs }, versions: report.versions, warnings: report.warnings, runs: byRun.size, rows_counted: rows.length, configs, shared_solved: all, pairs, rows };
}

const fixed = (value, digits = 0) => (value == null ? '-' : Number(value.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits }));
const pad = (value, width) => String(value).padEnd(width);

function table(header, body) {
  const widths = header.map((cell, index) => Math.max(String(cell).length, ...body.map((row) => String(row[index]).length)));
  const line = (row) => row.map((cell, index) => pad(cell, widths[index])).join('  ').trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...body.map(line)];
}

export function formatTrace(trace) {
  const lines = [];
  lines.push(`Trace of ${trace.rows_counted} counted row(s) from ${trace.runs} run(s). Read from stored events and results; nothing is stored or called.`);
  if (trace.versions?.length) lines.push(`Suite versions used: ${trace.versions.map((item) => `${item.suite} ${item.version ?? 'none'}`).join(', ')}.`);
  for (const warning of trace.warnings || []) lines.push(`Warning: ${warning.message}`);
  if (!trace.configs.length) {
    lines.push('No counted rows to trace. See node lab ladder.');
    return lines;
  }
  const events = (config) => (config.rows_without_parser === config.rows ? 'no parser' : `${config.rows_with_events}/${config.rows}`);
  const claims = (config) => (config.claims.rows_checked ? `${config.claims.contradicted} / ${config.claims.unknown} / ${config.claims.consistent}` : '-');
  const done = (config) => (config.said_done_check_failed.rows_checked ? config.said_done_check_failed.count : '-');
  lines.push('', ...table(
    ['configuration', 'rows with events', 'tool calls (median/row, total)', 'tests run', 'reads before 1st edit', 'repeated failing commands', 'median output tokens', 'contradicted / unknown / consistent claims', 'said done, check failed'],
    trace.configs.map((config) => [
      config.config_id,
      events(config),
      config.tool_calls.rows ? `${fixed(config.tool_calls.median_per_row, 1)}, ${fixed(config.tool_calls.total)}` : '-',
      config.tool_calls.rows ? `${fixed(config.tests_run.total)} in ${config.tests_run.rows_with_a_test} row(s)` : '-',
      config.reads_before_first_edit.rows ? `${config.reads_before_first_edit.share.toFixed(2)} (${config.reads_before_first_edit.rows} rows)` : '-',
      fixed(config.repeated_failing_commands),
      fixed(config.output_tokens.median, 1),
      claims(config),
      done(config),
    ]),
  ));
  const missing = trace.configs.filter((config) => config.rows_missing_events);
  for (const config of missing) lines.push(`${config.config_id}: ${config.rows_missing_events} row(s) have no events. They are missing from the process columns, not counted as zero.`);
  for (const config of trace.configs.filter((item) => item.said_done_check_not_run.count)) lines.push(`${config.config_id}: ${config.said_done_check_not_run.count} row(s) said done, and the hidden check did not run for them. They are not counted as a failed check.`);
  if (trace.pairs.length) {
    lines.push('', 'Median output tokens per solved task, on the tasks both configurations solved:');
    lines.push(...table(['configuration A', 'configuration B', 'shared solved tasks', 'median A', 'median B'], trace.pairs.map((pair) => [pair.a, pair.b, pair.tasks, fixed(pair.median_output_tokens[pair.a], 1), fixed(pair.median_output_tokens[pair.b], 1)])));
    for (const pair of trace.pairs.filter((item) => item.left_out_no_tokens)) lines.push(`${pair.a} and ${pair.b}: ${pair.left_out_no_tokens} task(s) solved by both are left out of the paired cost: a repeat has no output token count.`);
    if (trace.shared_solved && trace.configs.length > 2) lines.push(`Tasks solved by all ${trace.configs.length} configurations: ${trace.shared_solved.tasks}${trace.shared_solved.left_out_no_tokens ? ` (${trace.shared_solved.left_out_no_tokens} more left out: a repeat has no output token count)` : ''}.`);
  }
  lines.push(
    '',
    'Tool calls, tests, reads and failing commands come from the harness events. "-" means no event to read; "no parser" means this harness has no step parser.',
    'Reads before 1st edit: reads before the first edit as a share of all reads, mean over rows with at least one read and one edit.',
    'Repeated failing commands: a command that failed again after the same command had failed in the same row. A command counts as failed only when the harness states it.',
    'Claims: a claim is contradicted only when the final message says tests pass (or fail) and the events show the other: for the command the message names, or else for the last test run. No such run, or a last run with an unknown result, gives unknown. Agent tasks only.',
    'Said done, check failed: the final message reports finished work and the hidden check ran and scored below 1. A row whose check did not run is not counted here. It is not a claim of dishonesty.',
  );
  return lines;
}

export async function traceCommand(root, positionals, values = {}) {
  if (positionals?.length) throw new Error('trace takes options only: node lab trace [--suite <id>] [--suite-version <version>] [--runs <id,...>] [--json]');
  const suite = values.suite ?? null;
  const split = (items) => (items || []).flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
  const suiteVersions = split(values['suite-version']).map((item) => {
    if (item.includes('@')) return item;
    if (!suite) throw new Error(`--suite-version ${item} needs --suite <ladder suite>, or the form <suite>@<version>`);
    return `${suite}@${item}`;
  });
  const trace = await buildTrace(root, {
    suite,
    suiteVersions: suiteVersions.length ? suiteVersions : null,
    runs: values.runs ? split([values.runs]) : null,
    harness: values.harness ?? null,
    models: values.models ? split([values.models]) : null,
  });
  // The text holds no home path by construction; this makes sure of it.
  const output = values.json ? JSON.stringify(trace, null, 2) : formatTrace(trace).join('\n');
  console.log(scrub(output));
  return 0;
}
