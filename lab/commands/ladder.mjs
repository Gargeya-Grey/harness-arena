// node lab ladder: where configurations separate on the difficulty ladder
// (configs/ladder.yaml, docs/difficulty.md). It reads the derived view only: the rows
// that count (closed, ledger-matched, scored runs), exactly as the dashboard counts
// them. It writes nothing and calls no model.
//
//   ladderReport()   pure: { configs, tiers, cases } from the state and the ladder cases
//   formatLadder()   the text tables
//   ladderCommand()  loads, filters, prints (or prints JSON)

import fs from 'node:fs';
import path from 'node:path';
import { ladderStatus, withinMoveRange } from '../lib/ladder.mjs';
import { mean } from '../lib/metrics.mjs';
import { frozenVersions, loadSuite, loadYamlFile, paths } from '../lib/repo.mjs';
import { buildState, countedRows } from '../lib/state.mjs';

const EPS = 1e-9;
// Negative discrimination: a task is failed on every repeat when each score is under this
// (the same cut the dashboard uses for a pass when an evaluator gives no pass flag).
const FAIL_BELOW = 0.5;
const round = (value, digits = 3) => (value == null ? null : Number(value.toFixed(digits)));

/**
 * What to do with a case whose panel mean is outside its tier's band (docs/difficulty.md,
 * Calibration rule 3). Tiers whose band holds the mean are tried nearest first; the case
 * moves to the first one whose expert-time range is within a factor of 4 of the case's
 * human_minutes. None: the task is wrong for the scale and is reworked.
 */
export function verdictFor({ mean: value, tier, minutes, ladder }) {
  if (value == null) return { verdict: 'no data', move_to: null, distance: null };
  const [low, high] = tier.band;
  if (value >= low - EPS && value <= high + EPS) return { verdict: 'in band', move_to: null, distance: 0 };
  const distance = round(value < low ? low - value : value - high);
  const candidates = ladder.tiers
    .filter((other) => other.level !== tier.level && value >= other.band[0] - EPS && value <= other.band[1] + EPS)
    .sort((a, b) => Math.abs(a.level - tier.level) - Math.abs(b.level - tier.level) || a.level - b.level);
  const target = candidates.find((other) => withinMoveRange(minutes, other));
  return target ? { verdict: `move to ${target.name}`, move_to: target.level, distance } : { verdict: 'rework', move_to: null, distance };
}

/** One config's counted rows grouped by case: Map case_id -> { n, mean, solved, failed, scores }. */
function taskResults(rows) {
  const byCase = new Map();
  for (const row of countedRows(rows, true)) {
    if (!byCase.has(row.case_id)) byCase.set(row.case_id, []);
    byCase.get(row.case_id).push(row);
  }
  return new Map(
    [...byCase].map(([id, list]) => {
      const value = mean(list.map((row) => row.value));
      const scores = list.map((row) => row.value);
      return [id, { n: list.length, mean: value, solved: value >= 1 - EPS, failed: scores.every((score) => score < FAIL_BELOW), scores }];
    }),
  );
}

const versionParts = (version) => String(version).split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));

/** Dotted versions in order: 1.9.0 before 1.10.0; a non-numeric part compares as text. */
export function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

/**
 * Keep, per suite, only the counted runs of one suite version: the newest that has counted runs,
 * or the version named in `chosen` (Map suite id -> version). Runs of other versions are left out,
 * because a task reworked under the same case_id in a new version is a different measurement.
 * One suite version that mixes prompt versions, or quality evaluator versions, is refused: the scores
 * would not be comparable (AGENTS.md invariant 4).
 * Returns { rows, versions }; versions lists the suite, version, prompt, run count and runs left out.
 */
function selectVersions(observations, contextOf, chosen) {
  const runs = new Map();
  for (const row of observations) {
    if (!runs.has(row.run_id)) {
      const ctx = contextOf.get(row.context_key);
      const evaluators = (ctx.evaluators || []).filter((item) => item.dimension === 'quality').map((item) => `${item.id}@${item.version}`).sort().join(' + ');
      runs.set(row.run_id, { run_id: row.run_id, suite: ctx.suite.id, version: String(ctx.suite.version), prompt: `${ctx.prompt.id}@${ctx.prompt.version}`, evaluators, rows: [] });
    }
    runs.get(row.run_id).rows.push(row);
  }
  const counted = [...runs.values()].filter((run) => countedRows(run.rows, true).length > 0);
  const suites = [...new Set([...counted.map((run) => run.suite), ...chosen.keys()])].sort();
  const keep = new Set();
  const versions = [];
  for (const suiteId of suites) {
    const own = counted.filter((run) => run.suite === suiteId);
    const newest = [...new Set(own.map((run) => run.version))].sort(compareVersions).pop();
    const version = chosen.get(suiteId) ?? newest;
    const used = own.filter((run) => run.version === version);
    const prompts = [...new Set(used.map((run) => run.prompt))].sort();
    if (prompts.length > 1) {
      throw new Error(`${suiteId}@${version} has counted runs with different prompt versions (${prompts.join(', ')}); scores of different prompts are not comparable. Choose the runs with --runs.`);
    }
    const evaluators = [...new Set(used.map((run) => run.evaluators))].sort();
    if (evaluators.length > 1) {
      throw new Error(`${suiteId}@${version} has counted runs scored with different quality evaluator versions (${evaluators.join(', ')}); scores of different evaluator versions are not comparable. Choose the runs with --runs.`);
    }
    used.forEach((run) => keep.add(run.run_id));
    const other = own.filter((run) => run.version !== version);
    versions.push({ suite: suiteId, version: version ?? null, prompt: prompts[0] ?? null, runs: used.length, left_out_runs: other.length, left_out_versions: [...new Set(other.map((run) => run.version))].sort(compareVersions) });
  }
  return { rows: observations.filter((row) => keep.has(row.run_id)), versions };
}

/**
 * The ladder report, from data alone.
 *   state         { observations, contexts, configs } as buildState returns them
 *   ladder        loadLadder(root)
 *   ladderCases   [{ kind, suite, item }] as ladderStatus(root).cases returns them
 *   suite, runs   optional filters: a ladder suite id (or kind), and run ids
 *   suiteVersions optional ['<suite>@<version>', ...]: use that version of a suite instead of its newest
 *   diskVersions  optional Map suite id -> the suite version on disk (suite.yaml).
 *   versionCases  optional Map suite id -> Map version -> { cases, sha256 } of that version's frozen copy
 *                 (datasets/<suite>/versions/<version>/). Tiers, tier sizes and the case set come from the
 *                 version the scores are from: the suite on disk, or the frozen copy of an older version
 *                 (`versions[].cases_from` says which). A run stores no case metadata, so an older version
 *                 without a copy, or with a copy whose hash is not the one its runs recorded, falls back to
 *                 the suite on disk, and `warnings` says so, one entry per suite.
 *
 * A task is solved by a configuration when its mean score over the configuration's counted
 * repeats is 1. A tier cell holds solved / counted tasks and the mean of those tasks' means.
 * `tasks` is the tier's size in scope; `counted` is how many of them the configuration has.
 * A case's calibration mean is the mean of the configurations' task means (each configuration
 * counts once). A configuration's total mean is the mean over its counted tasks; it only orders the table.
 *
 * Per suite, only the counted runs of one suite version are used (selectVersions); `versions` says which.
 *
 * Negative discrimination (Calibration rule 4), per pair of configurations that both ran the case:
 * their abilities are their means over the other tasks both ran. The case is flagged when the pair's
 * higher-ability configuration scored under 0.5 on every repeat of the case and the other scored 1 on every repeat.
 */
export function ladderReport({ state, ladder, ladderCases, suite = null, runs = null, suiteVersions = null, diskVersions = null, versionCases = null }) {
  const onDiskScope = ladderCases.filter((entry) => !suite || entry.suite === suite || entry.kind === suite);
  const kindOf = new Map(onDiskScope.map((entry) => [entry.suite, entry.kind]));
  // The cases of a frozen suite version (versionCases: Map suite -> Map version -> cases) can be the
  // ones a run used; rows of every version a suite has are candidates until one version is chosen.
  const frozenOf = (suiteId, version) => versionCases?.get(suiteId)?.get(String(version)) ?? null;
  const candidateIds = new Set(onDiskScope.map((entry) => entry.item.case_id));
  for (const suiteId of kindOf.keys()) for (const copy of versionCases?.get(suiteId)?.values() ?? []) for (const item of copy.cases) candidateIds.add(item.case_id);
  const withQuality = new Set((state.contexts || []).filter((ctx) => (ctx.evaluators || []).some((item) => item.dimension === 'quality')).map((ctx) => ctx.key));
  const runSet = runs ? new Set(runs) : null;
  const contextOf = new Map((state.contexts || []).map((ctx) => [ctx.key, ctx]));
  const chosen = new Map();
  for (const entry of suiteVersions || []) {
    const at = entry.lastIndexOf('@');
    if (kindOf.has(entry.slice(0, at))) chosen.set(entry.slice(0, at), entry.slice(at + 1));
  }
  const selected = selectVersions(
    state.observations.filter((row) => row.trusted !== false && candidateIds.has(row.case_id) && withQuality.has(row.context_key) && (!runSet || runSet.has(row.run_id))),
    contextOf,
    chosen,
  );
  const { versions } = selected;
  // Per suite, the case set and tiers of the version used: the suite on disk, or the frozen copy of
  // an older version. Without a copy the disk's case set stands, and `warnings` says so.
  // A copy counts only when it is the content every chosen run of that suite recorded (its hash).
  const inScope = [];
  const badCopies = new Map();
  for (const suiteId of kindOf.keys()) {
    const used = versions.find((item) => item.suite === suiteId);
    const onDisk = diskVersions?.get(suiteId);
    let frozen = used?.version != null && onDisk != null && String(onDisk) !== used.version ? frozenOf(suiteId, used.version) : null;
    if (frozen) {
      const recorded = new Set(selected.rows.map((row) => contextOf.get(row.context_key)?.suite).filter((item) => item?.id === suiteId).map((item) => item.sha256));
      if ([...recorded].some((sha) => sha !== frozen.sha256)) {
        badCopies.set(suiteId, frozen.sha256);
        frozen = null;
      }
    }
    if (used) used.cases_from = frozen ? 'frozen copy' : 'disk';
    if (frozen) inScope.push(...frozen.cases.map((item) => ({ kind: kindOf.get(suiteId), suite: suiteId, item })));
    else inScope.push(...onDiskScope.filter((entry) => entry.suite === suiteId));
  }
  const caseIds = new Set(inScope.map((entry) => entry.item.case_id));
  const observations = selected.rows.filter((row) => caseIds.has(row.case_id));

  const rowsByConfig = new Map();
  for (const row of observations) {
    if (!rowsByConfig.has(row.config_id)) rowsByConfig.set(row.config_id, []);
    rowsByConfig.get(row.config_id).push(row);
  }
  const results = new Map([...rowsByConfig].map(([id, rows]) => [id, taskResults(rows)]));

  const tiers = ladder.tiers.map((tier) => ({
    level: tier.level,
    name: tier.name,
    band: tier.band,
    minutes: tier.minutes,
    tasks: inScope.filter((entry) => entry.item.metadata?.tier?.level === tier.level).length,
  }));
  const tierOf = new Map(inScope.map((entry) => [entry.item.case_id, entry.item.metadata?.tier?.level]));

  const configs = [...results].map(([id, tasks]) => {
    const cells = {};
    const all = [];
    for (const tier of tiers) {
      const own = [...tasks].filter(([caseId]) => tierOf.get(caseId) === tier.level).map(([, task]) => task);
      cells[tier.level] = { tasks: tier.tasks, counted: own.length, solved: own.filter((task) => task.solved).length, mean: round(mean(own.map((task) => task.mean))) };
      all.push(...own);
    }
    const total = { tasks: inScope.length, counted: all.length, solved: all.filter((task) => task.solved).length, mean: round(mean(all.map((task) => task.mean))) };
    const config = state.configs?.[id];
    return { config_id: id, label: config?.short_label ?? id, tiers: cells, total, _mean: mean(all.map((task) => task.mean)) };
  });
  configs.sort((a, b) => (b._mean ?? -1) - (a._mean ?? -1) || a.config_id.localeCompare(b.config_id));
  for (const config of configs) delete config._mean;

  const cases = inScope
    .map(({ kind, suite: suiteId, item }) => {
      const level = item.metadata?.tier?.level;
      const tier = ladder.byLevel.get(level);
      const perConfig = [...results]
        .filter(([, tasks]) => tasks.has(item.case_id))
        .map(([id, tasks]) => ({ config_id: id, ...tasks.get(item.case_id), mean: round(tasks.get(item.case_id).mean) }));
      const value = mean(perConfig.map((entry) => results.get(entry.config_id).get(item.case_id).mean));
      const verdict = tier ? verdictFor({ mean: value, tier, minutes: item.metadata?.tier?.human_minutes, ladder }) : { verdict: 'no data', move_to: null, distance: null };
      // Rule 4: of two configurations, the one with the higher mean on the other tasks both ran scores
      // under 0.5 on every repeat of this task while the other scores 1 on every repeat.
      const flags = [];
      for (const weak of perConfig.filter((entry) => entry.solved)) {
        for (const strong of perConfig.filter((entry) => entry.failed)) {
          const weakTasks = results.get(weak.config_id);
          const strongTasks = results.get(strong.config_id);
          const shared = [...weakTasks.keys()].filter((id) => id !== item.case_id && strongTasks.has(id));
          if (!shared.length) continue;
          const weakMean = mean(shared.map((id) => weakTasks.get(id).mean));
          const strongMean = mean(shared.map((id) => strongTasks.get(id).mean));
          if (strongMean > weakMean + EPS) {
            flags.push({ flag: 'negative discrimination', solved_by: weak.config_id, failed_by: strong.config_id, shared_tasks: shared.length, solved_by_mean: round(weakMean), failed_by_mean: round(strongMean) });
          }
        }
      }
      return {
        case_id: item.case_id,
        suite: suiteId,
        kind,
        tier: level ?? null,
        tier_name: tier?.name ?? null,
        human_minutes: item.metadata?.tier?.human_minutes ?? null,
        band: tier?.band ?? null,
        configs_n: perConfig.length,
        mean: round(value),
        ...verdict,
        flags,
        per_config: perConfig,
      };
    })
    .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || a.case_id.localeCompare(b.case_id));

  const warnings = [];
  for (const item of versions) {
    const onDisk = diskVersions?.get(item.suite);
    if (!item.runs || item.version == null || onDisk == null || String(onDisk) === item.version || item.cases_from === 'frozen copy') continue;
    warnings.push({
      suite: item.suite,
      scored_version: item.version,
      disk_version: String(onDisk),
      tier_source: 'disk',
      message: `${item.suite}: scores are from suite version ${item.version}, but the suite on disk is ${onDisk}. Tiers, tier sizes and the case set are those of ${onDisk}${badCopies.has(item.suite) ? `; the frozen copy of ${item.version} is not the content its runs used (hash ${badCopies.get(item.suite).slice(0, 12)}), so it is not read` : `; the tiers of ${item.version} are not stored in a run`}, so a task that changed tier between them is judged against its new tier.`,
    });
  }

  return { configs, tiers, cases, versions, warnings };
}

const fixed = (value) => (value == null ? 'n/a' : value.toFixed(2));
const pad = (value, width) => String(value).padEnd(width);

function table(header, rows) {
  const widths = header.map((cell, index) => Math.max(String(cell).length, ...rows.map((row) => String(row[index]).length)));
  const line = (row) => row.map((cell, index) => pad(cell, widths[index])).join('  ').trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)];
}

/** The two tables as lines of text. `calibrate` adds the per-case table. */
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
    lines.push('', 'Calibration: mean score of each task across the configurations that ran it, against its tier band.');
    const caseRows = report.cases.map((entry) => [
      entry.case_id,
      `${entry.tier ?? '?'} ${entry.tier_name ?? ''}`.trim(),
      fixed(entry.mean),
      entry.configs_n,
      entry.band ? `${fixed(entry.band[0])}-${fixed(entry.band[1])}` : 'n/a',
      entry.verdict,
      entry.flags.length ? 'negative discrimination' : '',
    ]);
    lines.push(...table(['case', 'tier', 'mean', 'configs', 'band', 'verdict', 'check'], caseRows));
    for (const entry of report.cases.filter((item) => item.flags.length)) {
      for (const flag of entry.flags) lines.push(`  ${entry.case_id}: solved by ${flag.solved_by}, failed on every repeat by ${flag.failed_by}, which has the higher mean on the ${flag.shared_tasks} other shared task(s) (${fixed(flag.failed_by_mean)} against ${fixed(flag.solved_by_mean)}); check the task for a defect first`);
    }
    const counts = {};
    for (const entry of report.cases) {
      const kind = entry.verdict.startsWith('move to') ? 'move' : entry.verdict;
      counts[kind] = (counts[kind] || 0) + 1;
    }
    lines.push(`Verdicts: ${Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(', ') || 'none'}.`);
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
  const versionCases = new Map();
  for (const id of known) {
    const dir = path.join(paths(root).datasets, id);
    const file = path.join(dir, 'suite.yaml');
    const version = fs.existsSync(file) ? loadYamlFile(file)?.version : null;
    if (version != null) diskVersions.set(id, String(version));
    const copies = new Map();
    for (const old of frozenVersions(dir)) {
      const copy = loadSuite(root, id, { version: old });
      if (copy) copies.set(old, { cases: copy.cases, sha256: copy.sha256 });
    }
    versionCases.set(id, copies);
  }
  const report = ladderReport({ state, ladder: status.ladder, ladderCases: status.cases, suite: chosen, runs: runIds, suiteVersions: versionRefs, diskVersions, versionCases });
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
