// node lab ladder: where configurations separate on the difficulty ladder
// (configs/ladder.yaml, docs/difficulty.md). It reads the derived view only: the rows
// that count (closed, ledger-matched, scored runs), exactly as the dashboard counts
// them. It writes nothing and calls no model.
//
//   ladderReport()   pure: { configs, tiers, cases } from the state and the ladder cases
//   formatLadder()   the text tables
//   ladderCommand()  loads, filters, prints (or prints JSON)

import { ladderStatus } from '../lib/ladder.mjs';
import { mean } from '../lib/metrics.mjs';
import { buildState, countedRows } from '../lib/state.mjs';

const EPS = 1e-9;
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
  const target = candidates.find((other) => typeof minutes === 'number' && minutes >= other.minutes[0] / 4 && minutes <= other.minutes[1] * 4);
  return target ? { verdict: `move to ${target.name}`, move_to: target.level, distance } : { verdict: 'rework', move_to: null, distance };
}

/** One config's counted rows grouped by case: Map case_id -> { n, mean, solved, failed }. */
function taskResults(rows) {
  const byCase = new Map();
  for (const row of countedRows(rows, true)) {
    if (!byCase.has(row.case_id)) byCase.set(row.case_id, []);
    byCase.get(row.case_id).push(row);
  }
  return new Map(
    [...byCase].map(([id, list]) => {
      const value = mean(list.map((row) => row.value));
      return [id, { n: list.length, mean: value, solved: value >= 1 - EPS, failed: !list.some((row) => row.passed) }];
    }),
  );
}

/**
 * The ladder report, from data alone.
 *   state         { observations, contexts, configs } as buildState returns them
 *   ladder        loadLadder(root)
 *   ladderCases   [{ kind, suite, item }] as ladderStatus(root).cases returns them
 *   suite, runs   optional filters: a ladder suite id (or kind), and run ids
 *
 * A task is solved by a configuration when its mean score over the configuration's counted
 * repeats is 1. A tier cell holds solved / counted tasks and the mean of those tasks' means.
 * `tasks` is the tier's size in scope; `counted` is how many of them the configuration has.
 * A case's calibration mean is the mean of the configurations' task means (each configuration
 * counts once). A configuration's total mean is the mean over its counted tasks, and ranks
 * configurations for the negative-discrimination check (Calibration rule 4).
 */
export function ladderReport({ state, ladder, ladderCases, suite = null, runs = null }) {
  const inScope = ladderCases.filter((entry) => !suite || entry.suite === suite || entry.kind === suite);
  const caseIds = new Set(inScope.map((entry) => entry.item.case_id));
  const withQuality = new Set((state.contexts || []).filter((ctx) => (ctx.evaluators || []).some((item) => item.dimension === 'quality')).map((ctx) => ctx.key));
  const runSet = runs ? new Set(runs) : null;
  const observations = state.observations.filter((row) => row.trusted !== false && caseIds.has(row.case_id) && withQuality.has(row.context_key) && (!runSet || runSet.has(row.run_id)));

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
  const totalOf = new Map(configs.map((config) => [config.config_id, config._mean]));
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
      // Rule 4: a configuration with a lower total solves it while one with a higher total fails every repeat.
      const flags = [];
      for (const weak of perConfig.filter((entry) => entry.solved)) {
        for (const strong of perConfig.filter((entry) => entry.failed)) {
          if (totalOf.get(strong.config_id) > totalOf.get(weak.config_id) + EPS) {
            flags.push({ flag: 'negative discrimination', solved_by: weak.config_id, failed_by: strong.config_id });
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

  return { configs, tiers, cases };
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
      for (const flag of entry.flags) lines.push(`  ${entry.case_id}: solved by ${flag.solved_by}, failed on every repeat by ${flag.failed_by}, which has the higher total; check the task for a defect first`);
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

export function ladderCommand(root, { calibrate = false, json = false, suite = null, runs = null, log = console.log } = {}) {
  let status;
  try {
    status = ladderStatus(root);
  } catch (error) {
    throw new Error(error.code === 'ENOENT' ? 'No usable difficulty ladder in this data root: configs/ladder.yaml does not exist' : `No usable difficulty ladder in this data root (configs/ladder.yaml): ${error.message}`);
  }
  const known = Object.values(status.ladder.suites);
  const chosen = suite ? (SUITE_ALIASES[suite] ?? suite) : null;
  if (chosen && !known.includes(chosen)) throw new Error(`--suite must be one of ${known.join(', ')}; got "${suite}"`);
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
  const report = ladderReport({ state, ladder: status.ladder, ladderCases: status.cases, suite: chosen, runs: runIds });
  if (json) {
    log(JSON.stringify({ problems: status.problems, filters: { suite: chosen, runs: runIds }, ...report }, null, 2));
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
