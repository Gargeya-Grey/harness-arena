// node lab ladder: where configurations separate on the difficulty ladder
// (configs/ladder.yaml, docs/difficulty.md). It reads the derived view only: the rows
// that count (closed, ledger-matched, scored runs), exactly as the dashboard counts them.
// It writes nothing and calls no model.
//
//   ladderReport()   pure: { configs, tiers, cases, pairs } from the state and the ladder cases (lab/lib/ladder.mjs)
//   formatLadder()   the text tables
//   ladderCommand()  loads, filters, prints (or prints JSON)

import fs from 'node:fs';
import path from 'node:path';
import { INFORMATION, compareVersions, ladderReport, ladderStatus } from '../lib/ladder.mjs';
import { loadSuite, loadYamlFile, paths } from '../lib/repo.mjs';
import { buildState } from '../lib/state.mjs';

export { compareVersions, ladderReport };

const fixed = (value) => (value == null ? 'n/a' : value.toFixed(2));
const pad = (value, width) => String(value).padEnd(width);
const pText = (value) => (value < 0.005 ? '< 0.01' : fixed(value));

function table(header, rows) {
  const widths = header.map((cell, index) => Math.max(String(cell).length, ...rows.map((row) => String(row[index]).length)));
  const line = (row) => row.map((cell, index) => pad(cell, widths[index])).join('  ').trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)];
}

/** `A vs B: 52 shared, 5 and 1, p 0.22`: the tasks both have, the tasks only one solved, the exact sign test. */
export const pairLine = (pair) => `${pair.a_label} vs ${pair.b_label}: ${pair.shared} shared, ${pair.a_only} and ${pair.b_only}, p ${pText(pair.sign_p)}`;

/** The two tables as lines of text. `calibrate` adds the per-case table and the pair table. */
export function formatLadder(report, { calibrate = false } = {}) {
  const lines = [];
  const cell = (entry) => (entry.counted ? `${entry.solved}/${entry.counted}${entry.counted < entry.tasks ? '*' : ''}  ${fixed(entry.mean)}` : '-');
  const header = ['configuration', ...report.tiers.map((tier) => `${tier.level} ${tier.name} (${tier.tasks})`), 'total'];
  const rows = report.configs.map((config) => [config.config_id, ...report.tiers.map((tier) => cell(config.tiers[tier.level])), cell(config.total)]);
  lines.push('Solved / tasks counted, then mean score (a task is solved at mean score 1 over its counted repeats).');
  lines.push(...table(header, rows));
  if (report.versions?.length) {
    const used = report.versions.map((item) => `${item.suite} ${item.version ?? 'none'} (${item.runs} run${item.runs === 1 ? '' : 's'}${item.cases_from === 'frozen copy' ? '; cases and tiers of its frozen copy' : ''})`).join(', ');
    const left = report.versions.reduce((sum, item) => sum + item.left_out_runs, 0);
    const detail = report.versions.filter((item) => item.left_out_runs).map((item) => `${item.suite} ${item.left_out_versions.join(', ')}`).join('; ');
    lines.push(`Suite versions used: ${used}. Left out: ${left} counted run${left === 1 ? '' : 's'} of other versions${left ? ` (${detail})` : ''}.`);
  }
  for (const warning of report.warnings || []) lines.push(`Warning: ${warning.message}`);
  if (!rows.length) lines.push('No counted ladder runs yet. Run an experiment from experiments/ladder-*.yaml, or see node lab runs.');
  if (rows.some((row) => row.some((text) => String(text).includes('*')))) lines.push('* the configuration has counted results for fewer tasks than the tier holds.');
  if (calibrate) {
    lines.push('', 'Information: what each task can tell about the configurations that ran it (a tier is an estimate label, not a result).');
    lines.push('  disagree = some solved it and some did not; one-config = one configuration has a result; all-solved / all-unsolved = no difference; no-data = no counted result.');
    const caseRows = report.cases.map((entry) => [
      entry.case_id,
      `${entry.tier ?? '?'} ${entry.tier_name ?? ''}`.trim(),
      entry.configs_n,
      entry.information,
      entry.flags.length ? 'negative discrimination' : '',
    ]);
    lines.push(...table(['case', 'tier', 'configs', 'information', 'check'], caseRows));
    for (const entry of report.cases.filter((item) => item.flags.length)) {
      for (const flag of entry.flags) lines.push(`  ${entry.case_id}: solved by ${flag.solved_by}, failed on every repeat by ${flag.failed_by}, which has the higher mean on the ${flag.shared_tasks} other shared task(s) (${fixed(flag.failed_by_mean)} against ${fixed(flag.solved_by_mean)}); check the task for a defect first`);
    }
    lines.push(`Information: ${INFORMATION.filter((name) => report.information[name]).map((name) => `${report.information[name]} ${name}`).join(', ') || 'none'}.`);
    lines.push('', 'Pairs: tasks both configurations have counted results for. The two numbers are the tasks only the first, and only the second, solved; p is the exact two-sided sign test on them.');
    if (report.pairs.length) for (const pair of report.pairs) lines.push(`  ${pairLine(pair)}`);
    else lines.push('  No two configurations share a counted task.');
  }
  return lines;
}

const SUITE_ALIASES = { answer: 'ladder-answer', code: 'ladder-code', agent: 'ladder-agent' };

export function ladderCommand(root, { calibrate = false, json = false, suite = null, runs = null, suiteVersions = null, log = console.log } = {}) {
  let status;
  try {
    status = ladderStatus(root);
  } catch (error) {
    throw new Error(error.code === 'ENOENT' ? 'No usable difficulty ladder in this data root: configs/ladder.yaml does not exist' : `No usable difficulty ladder in this data root (configs/ladder.yaml): ${error.message}`);
  }
  const known = Object.values(status.ladder.suites);
  const chosen = suite ? (SUITE_ALIASES[suite] ?? suite) : null;
  if (chosen && !known.includes(chosen)) throw new Error(`--suite must be one of ${known.join(', ')}; got "${suite}"`);
  const picked = new Map();
  for (const ref of suiteVersions || []) {
    const at = String(ref).lastIndexOf('@');
    const id = SUITE_ALIASES[ref.slice(0, Math.max(at, 0))] ?? ref.slice(0, Math.max(at, 0));
    if (at < 1 || at === ref.length - 1 || !known.includes(id)) throw new Error(`--suite-version must be <suite>@<version> with a suite from ${known.join(', ')}; got "${ref}"`);
    const version = ref.slice(at + 1);
    if (picked.has(id) && picked.get(id) !== version) throw new Error(`--suite-version names two versions of ${id}: ${picked.get(id)} and ${version}`);
    if (chosen && id !== chosen) throw new Error(`--suite-version ${ref} is for a suite that --suite ${suite} leaves out; drop one of them`);
    picked.set(id, version);
  }
  const versionRefs = [...picked].map(([id, version]) => `${id}@${version}`);
  const state = buildState(root, { validate: false });
  let runIds = null;
  if (runs) {
    runIds = [];
    for (const ref of runs) {
      const matches = state.runs.map((run) => run.run_id).filter((id) => id === ref || id.includes(ref));
      const exact = matches.filter((id) => id === ref);
      if (!matches.length) throw new Error(`--runs: no run matches "${ref}"`);
      if (!exact.length && matches.length > 1) throw new Error(`--runs: "${ref}" matches ${matches.length} runs; give more of the run id`);
      runIds.push(...(exact.length ? exact : matches));
    }
  }
  const diskVersions = new Map();
  for (const id of known) {
    const file = path.join(paths(root).datasets, id, 'suite.yaml');
    const version = fs.existsSync(file) ? loadYamlFile(file)?.version : null;
    if (version != null) diskVersions.set(id, String(version));
  }
  // A frozen copy is read only when a report needs it.
  const copies = new Map();
  const frozenCopy = (id, version) => {
    const key = `${id}@${version}`;
    if (!copies.has(key)) {
      const copy = loadSuite(root, id, { version });
      copies.set(key, copy?.frozen ? { cases: copy.cases, sha256: copy.sha256 } : null);
    }
    return copies.get(key);
  };
  const report = ladderReport({ state, ladder: status.ladder, ladderCases: status.cases, suite: chosen, runs: runIds, suiteVersions: versionRefs, diskVersions, frozenCopy });
  if (json) {
    log(JSON.stringify({ problems: status.problems, filters: { suite: chosen, runs: runIds, suite_versions: versionRefs.length ? versionRefs : null }, ...report }, null, 2));
    return report;
  }
  if (status.problems.length) {
    log(`Ladder problems (${status.problems.length}):`);
    for (const problem of status.problems) log(`  ${problem}`);
    log('');
  }
  for (const line of formatLadder(report, { calibrate })) log(line);
  return report;
}
