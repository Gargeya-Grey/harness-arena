// The difficulty ladder (configs/ladder.yaml, docs/difficulty.md): five tiers over
// three suites. This file turns case definitions into ladder cases and checks
// ladder cases against the tier table.
//
// A definition is one file under datasets/<suite>/defs/ (any depth). Its default
// export is a definition, an array of them, or a function (sync or async) that
// returns either. Every definition has
//   slug   lowercase words joined by dashes; the case_id is <suite>-<slug>
//   tier   { level, human_minutes, basis, origin? }
//   tags   optional extra tags
// plus the fields its suite's generate.mjs turns into input and expected.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadYamlFile, paths } from './repo.mjs';
import { readJsonl } from './fsutil.mjs';
import { mean } from './metrics.mjs';
// state.mjs imports this file for state.ladder; both only call each other's functions at run time.
import { countedRows } from './state.mjs';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function loadLadder(root) {
  const ladder = loadYamlFile(path.join(root, 'configs', 'ladder.yaml'));
  ladder.byLevel = new Map(ladder.tiers.map((tier) => [tier.level, tier]));
  return ladder;
}

export const tierTag = (tier) => `tier-${tier.level}-${tier.name}`;

/** Every definition file under dir, in a stable order. Files whose name starts with _ are helpers. */
export function definitionFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...definitionFiles(full));
    else if (entry.name.endsWith('.mjs') && !entry.name.startsWith('_')) out.push(full);
  }
  return out;
}

export async function loadDefinitions(dir) {
  const defs = [];
  for (const file of definitionFiles(dir)) {
    let value = (await import(pathToFileURL(file).href)).default;
    if (typeof value === 'function') value = await value();
    for (const def of [value].flat()) defs.push({ ...def, file: path.relative(dir, file).replaceAll('\\', '/') });
  }
  return defs;
}

/**
 * The tasks a suite has retired: defs/_retired.mjs default-exports { <slug>: <reason> }.
 * A retired task keeps its definition, so its slug stays taken (a case_id is never reused)
 * and its proofs keep running, but it is not in cases.jsonl. Bringing it back is one line.
 */
export async function loadRetired(dir) {
  const file = path.join(dir, '_retired.mjs');
  if (!fs.existsSync(file)) return new Map();
  const list = (await import(pathToFileURL(file).href)).default || {};
  for (const [slug, reason] of Object.entries(list)) {
    if (typeof reason !== 'string' || reason.trim().length < 10) throw new Error(`_retired.mjs: "${slug}" needs a reason`);
  }
  return new Map(Object.entries(list));
}

/**
 * Ladder cases from definitions. toCase(def) returns { input, expected, tags?, metadata? }
 * for one definition; this adds the case_id, the tier tag and metadata.tier, and sorts by
 * tier, then slug. Throws on a bad slug or tier, a slug used twice, or a retired slug that
 * no definition has. Retired definitions are checked and left out, unless includeRetired
 * (for the tests that prove them); then metadata.tier.retired holds the reason.
 */
export async function assembleCases({ suiteId, defs, ladder, toCase, retired = new Map(), includeRetired = false }) {
  const seen = new Set();
  const cases = [];
  for (const def of defs) {
    if (!SLUG.test(def.slug || '')) throw new Error(`${def.file}: bad slug "${def.slug}"`);
    if (seen.has(def.slug)) throw new Error(`${def.file}: slug "${def.slug}" is used twice`);
    seen.add(def.slug);
    const tier = ladder.byLevel.get(def.tier?.level);
    if (!tier) throw new Error(`${def.file}: tier.level must be one of ${[...ladder.byLevel.keys()].join(', ')}`);
    if (retired.has(def.slug) && !includeRetired) continue;
    const made = await toCase(def);
    const metadata = { ...(made.metadata || {}), tier: { level: tier.level, name: tier.name, human_minutes: def.tier.human_minutes, basis: def.tier.basis } };
    if (def.tier.origin) metadata.tier.origin = def.tier.origin;
    if (def.tier.moved !== undefined) metadata.tier.moved = def.tier.moved;
    if (retired.has(def.slug)) metadata.tier.retired = retired.get(def.slug);
    cases.push({
      case_id: `${suiteId}-${def.slug}`,
      input: made.input,
      expected: made.expected,
      tags: [tierTag(tier), ...new Set([...(def.tags || []), ...(made.tags || [])])],
      metadata,
    });
  }
  const unknown = [...retired.keys()].filter((slug) => !seen.has(slug));
  if (unknown.length) throw new Error(`_retired.mjs names ${unknown.join(', ')}, which no definition has`);
  return cases.sort((a, b) => a.metadata.tier.level - b.metadata.tier.level || a.case_id.localeCompare(b.case_id));
}

export const casesText = (cases) => cases.map((item) => `${JSON.stringify(item)}\n`).join('');

// docs/difficulty.md, Moving a task: a task may carry the label of a tier whose expert-time range is
// within this factor of the task's own expert time.
export const MOVE_FACTOR = 4;
export const withinMoveRange = (minutes, tier) =>
  typeof minutes === 'number' && minutes >= tier.minutes[0] / MOVE_FACTOR && minutes <= tier.minutes[1] * MOVE_FACTOR;

/**
 * Problems with one ladder case: tier fields, tag, and expert time inside the tier's range.
 * A case that calibration moved (metadata.tier.moved = { from, evidence }) keeps its expert
 * time, which then only has to be within a factor of MOVE_FACTOR of the new tier's range.
 */
export function caseProblems(item, ladder) {
  const problems = [];
  const at = item.case_id;
  const meta = item.metadata?.tier;
  const tier = ladder.byLevel.get(meta?.level);
  if (!tier) return [`${at}: metadata.tier.level is missing or unknown`];
  if (meta.name !== tier.name) problems.push(`${at}: tier name "${meta.name}" is not "${tier.name}"`);
  if (item.tags?.[0] !== tierTag(tier)) problems.push(`${at}: first tag must be "${tierTag(tier)}"`);
  const [low, high] = tier.minutes;
  const moved = meta.moved;
  if (moved !== undefined) {
    if (!moved || !ladder.byLevel.has(moved.from) || moved.from === tier.level) problems.push(`${at}: tier.moved.from must be the level of another tier`);
    if (typeof moved?.evidence !== 'string' || moved.evidence.trim().length < 10) problems.push(`${at}: tier.moved.evidence must name the pilot that moved the task`);
    if (!withinMoveRange(meta.human_minutes, tier)) {
      problems.push(`${at}: human_minutes ${meta.human_minutes} is more than a factor of ${MOVE_FACTOR} outside ${tier.name} (${low} to ${high}), too far for a moved task`);
    }
  } else if (!(typeof meta.human_minutes === 'number' && meta.human_minutes > low && meta.human_minutes <= high)) {
    problems.push(`${at}: human_minutes ${meta.human_minutes} is outside ${tier.name} (more than ${low}, at most ${high})`);
  }
  if (typeof meta.basis !== 'string' || meta.basis.trim().length < 10) problems.push(`${at}: metadata.tier.basis must say how the time was estimated`);
  return problems;
}

/** The ladder as stored: cases per suite and tier, and every problem against configs/ladder.yaml. */
export function ladderStatus(root) {
  const ladder = loadLadder(root);
  const problems = [];
  const counts = new Map(ladder.tiers.map((tier) => [tier.level, Object.fromEntries(Object.keys(ladder.suites).map((kind) => [kind, 0]))]));
  const cases = [];
  for (const [kind, suiteId] of Object.entries(ladder.suites)) {
    const file = path.join(paths(root).datasets, suiteId, 'cases.jsonl');
    const { rows, problems: lineProblems } = readJsonl(file);
    for (const line of lineProblems) problems.push(`${suiteId}/cases.jsonl:${line.line}: ${line.message}`);
    for (const item of rows) {
      cases.push({ kind, suite: suiteId, item });
      problems.push(...caseProblems(item, ladder));
      const level = item.metadata?.tier?.level;
      if (counts.has(level)) counts.get(level)[kind] += 1;
    }
  }
  for (const tier of ladder.tiers) {
    const kinds = Object.values(tier.kinds).reduce((sum, n) => sum + n, 0);
    if (kinds !== tier.tasks) problems.push(`configs/ladder.yaml: ${tier.name} kinds add up to ${kinds}, not ${tier.tasks}`);
    for (const [kind, want] of Object.entries(tier.kinds)) {
      const have = counts.get(tier.level)[kind];
      if (have !== want) problems.push(`${tier.name}: ${have} ${kind} task(s), the ladder asks for ${want}`);
    }
  }
  return { ladder, cases, counts, problems };
}

// ---------------------------------------------------------------------------------------------
// What the stored scores say about a task and about a pair of configurations. A tier is an estimate
// label (docs/difficulty.md); nothing here compares a score with a target.

const EPS = 1e-9;
// A task is failed on every repeat when each score is under this (the cut the dashboard uses for a
// pass when an evaluator gives no pass flag).
const FAIL_BELOW = 0.5;
const round = (value, digits = 3) => (value == null ? null : Number(value.toFixed(digits)));

/** The information classes of a task, most useful first. */
export const INFORMATION = ['disagree', 'one-config', 'all-solved', 'all-unsolved', 'no-data'];

// A configuration solves a task when its mean over its counted repeats is 1.
const solvedBy = (entry) => (typeof entry.solved === 'boolean' ? entry.solved : entry.mean != null && entry.mean >= 1 - EPS);
const meanOf = (entry) => (Array.isArray(entry.scores) && entry.scores.length ? mean(entry.scores) : entry.mean);

/**
 * What a task can tell about the configurations that ran it. `caseRow` holds per_config, one entry
 * per configuration that has counted results for the task.
 *   no-data      no configuration has a counted result
 *   one-config   one configuration has: nothing to compare, whatever it scored
 *   all-solved   every configuration solved it
 *   all-unsolved none solved it (equal partial scores are here too)
 *   disagree     some solved it and some did not
 */
export function taskInformation(caseRow) {
  const list = Array.isArray(caseRow) ? caseRow : caseRow?.per_config || [];
  if (!list.length) return 'no-data';
  if (list.length === 1) return 'one-config';
  const solved = list.filter(solvedBy).length;
  if (solved === list.length) return 'all-solved';
  if (solved === 0) return 'all-unsolved';
  return 'disagree';
}

/** Two-sided exact sign test: the chance of a split at least this uneven among n tasks only one side solved, if both were equally likely to win. */
export function signTestP(a, b) {
  const n = a + b;
  if (n === 0) return 1;
  const k = Math.min(a, b);
  let term = 0.5 ** n;
  let tail = 0;
  for (let i = 0; i <= k; i += 1) {
    tail += term;
    term = (term * (n - i)) / (i + 1);
  }
  return Math.min(1, 2 * tail);
}

/**
 * The evidence two configurations give each other, from the tasks both have counted results for.
 * `a_only` is the tasks only a solved, `b_only` the tasks only b solved; the other shared tasks
 * (both solved, or neither) do not separate them. `sign_p` is the exact two-sided sign test on
 * a_only against b_only. `mean_diff` is the mean over shared tasks of a's task mean minus b's.
 */
export function pairEvidence(cases, a, b) {
  let shared = 0;
  let aOnly = 0;
  let bOnly = 0;
  let diff = 0;
  for (const item of cases) {
    const x = item.per_config?.find((entry) => entry.config_id === a);
    const y = item.per_config?.find((entry) => entry.config_id === b);
    if (!x || !y) continue;
    shared += 1;
    const sx = solvedBy(x);
    const sy = solvedBy(y);
    if (sx && !sy) aOnly += 1;
    else if (sy && !sx) bOnly += 1;
    diff += meanOf(x) - meanOf(y);
  }
  return { shared, a_only: aOnly, b_only: bOnly, sign_p: signTestP(aOnly, bOnly), mean_diff: shared ? round(diff / shared) : null };
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
 * would not be comparable (AGENTS.md invariant 4). With `keepOtherSuites` only that suite is left out,
 * and its `versions` entry holds the reason in `refused`; without it the whole report is refused.
 * Returns { rows, versions }; versions lists the suite, version, prompt, run count and runs left out.
 */
function selectVersions(observations, contextOf, chosen, keepOtherSuites) {
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
    const evaluators = [...new Set(used.map((run) => run.evaluators))].sort();
    const refusal = prompts.length > 1
      ? `${suiteId}@${version} has counted runs with different prompt versions (${prompts.join(', ')}); scores of different prompts are not comparable. Choose the runs with --runs.`
      : evaluators.length > 1
        ? `${suiteId}@${version} has counted runs scored with different quality evaluator versions (${evaluators.join(', ')}); scores of different evaluator versions are not comparable. Choose the runs with --runs.`
        : null;
    if (refusal && !keepOtherSuites) throw new Error(refusal);
    if (refusal) {
      versions.push({ suite: suiteId, version: version ?? null, prompt: null, runs: 0, left_out_runs: own.length, left_out_versions: [], refused: refusal });
      continue;
    }
    used.forEach((run) => keep.add(run.run_id));
    const other = own.filter((run) => run.version !== version);
    versions.push({ suite: suiteId, version: version ?? null, prompt: prompts[0] ?? null, runs: used.length, left_out_runs: other.length, left_out_versions: [...new Set(other.map((run) => run.version))].sort(compareVersions) });
  }
  return { rows: observations.filter((row) => keep.has(row.run_id)), versions };
}

/**
 * The ladder report, from data alone.
 *   state         { observations, contexts, configs, runs } as buildState returns them
 *   ladder        loadLadder(root)
 *   ladderCases   [{ kind, suite, item }] as ladderStatus(root).cases returns them
 *   suite, runs   optional filters: a ladder suite id (or kind), and run ids
 *   suiteVersions optional ['<suite>@<version>', ...]: use that version of a suite instead of its newest
 *   diskVersions  optional Map suite id -> the suite version on disk (suite.yaml).
 *   frozenCopy    optional (suite id, version) => { cases, sha256 } | null: the frozen copy of an older
 *                 suite version (datasets/<suite>/versions/<version>/). Tiers, tier sizes and the case set
 *                 come from the version the scores are from: the suite on disk, or the frozen copy of an
 *                 older version (`versions[].cases_from` says which). A run stores no case metadata, so an
 *                 older version without a copy, or with a copy whose hash is not the one its runs recorded,
 *                 falls back to the suite on disk, and `warnings` says so, one entry per suite.
 *
 * A task is solved by a configuration when its mean score over the configuration's counted
 * repeats is 1. A tier cell holds solved / counted tasks and the mean of those tasks' means.
 * `tasks` is the tier's size in scope; `counted` is how many of them the configuration has.
 * A configuration's total mean is the mean over its counted tasks; it only orders the table.
 * Every case in scope is listed, those no configuration ran too (information `no-data`), with its
 * information class (taskInformation). `pairs` holds pairEvidence for every two configurations
 * that share a counted task.
 *
 * Per suite, only the counted runs of one suite version are used (selectVersions); `versions` says which.
 *
 * Negative discrimination, per pair of configurations that both ran the case:
 * their abilities are their means over the other tasks both ran. The case is flagged when the pair's
 * higher-ability configuration scored under 0.5 on every repeat of the case and the other scored 1 on every repeat.
 */
export function ladderReport({ state, ladder, ladderCases, suite = null, runs = null, suiteVersions = null, diskVersions = null, frozenCopy = null, keepOtherSuites = false }) {
  const onDiskScope = ladderCases.filter((entry) => !suite || entry.suite === suite || entry.kind === suite);
  const kindOf = new Map(onDiskScope.map((entry) => [entry.suite, entry.kind]));
  const withQuality = new Set((state.contexts || []).filter((ctx) => (ctx.evaluators || []).some((item) => item.dimension === 'quality')).map((ctx) => ctx.key));
  const runSet = runs ? new Set(runs) : null;
  const contextOf = new Map((state.contexts || []).map((ctx) => [ctx.key, ctx]));
  const chosen = new Map();
  for (const entry of suiteVersions || []) {
    const at = entry.lastIndexOf('@');
    if (kindOf.has(entry.slice(0, at))) chosen.set(entry.slice(0, at), entry.slice(at + 1));
  }
  const selected = selectVersions(
    state.observations.filter((row) => row.trusted !== false && kindOf.has(contextOf.get(row.context_key)?.suite?.id) && withQuality.has(row.context_key) && (!runSet || runSet.has(row.run_id))),
    contextOf,
    chosen,
    keepOtherSuites,
  );
  const { versions } = selected;
  // Per suite, the case set and tiers of the version used: the suite on disk, or the frozen copy of
  // an older version. Without a copy the disk's case set stands, and `warnings` says so.
  // A copy counts only when it is the content every chosen run of that suite recorded (its hash).
  const inScope = [];
  const badCopies = new Map();
  for (const suiteId of kindOf.keys()) {
    const used = versions.find((item) => item.suite === suiteId);
    // Its runs are not comparable, and no case set can be named for them.
    if (used?.refused) continue;
    const onDisk = diskVersions?.get(suiteId);
    let frozen = used?.version != null && onDisk != null && String(onDisk) !== used.version ? frozenCopy?.(suiteId, used.version) ?? null : null;
    if (frozen) {
      // From each run, not its context: a context keeps only the first hash of the runs it merges.
      const suiteOfRun = new Map((state.runs || []).map((run) => [run.run_id, run.suite]));
      const recorded = new Set(selected.rows.map((row) => suiteOfRun.get(row.run_id)).filter((item) => item?.id === suiteId).map((item) => item.sha256));
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
    return { config_id: id, label: config?.short_label ?? id, setup_state: config?.setup_state ?? null, tiers: cells, total, _mean: mean(all.map((task) => task.mean)) };
  });
  configs.sort((a, b) => (b._mean ?? -1) - (a._mean ?? -1) || a.config_id.localeCompare(b.config_id));
  for (const config of configs) delete config._mean;
  // A short label leaves out the harness version, so two configurations can share one. Then only the id tells them apart.
  const labelUses = new Map();
  for (const config of configs) labelUses.set(config.label, (labelUses.get(config.label) || 0) + 1);
  for (const config of configs) if (labelUses.get(config.label) > 1) config.label = config.config_id;

  const cases = inScope
    .map(({ kind, suite: suiteId, item }) => {
      const level = item.metadata?.tier?.level;
      const tier = ladder.byLevel.get(level);
      const perConfig = [...results]
        .filter(([, tasks]) => tasks.has(item.case_id))
        .map(([id, tasks]) => ({ config_id: id, ...tasks.get(item.case_id), mean: round(tasks.get(item.case_id).mean) }));
      // Negative discrimination: of two configurations, the one with the higher mean on the other tasks
      // both ran scores under 0.5 on every repeat of this task while the other scores 1 on every repeat.
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
        configs_n: perConfig.length,
        information: taskInformation({ per_config: perConfig }),
        flags,
        per_config: perConfig,
      };
    })
    .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || a.case_id.localeCompare(b.case_id));

  const pairs = [];
  for (let i = 0; i < configs.length; i += 1) {
    for (let j = i + 1; j < configs.length; j += 1) {
      const evidence = pairEvidence(cases, configs[i].config_id, configs[j].config_id);
      if (evidence.shared) pairs.push({ a: configs[i].config_id, b: configs[j].config_id, a_label: configs[i].label, b_label: configs[j].label, ...evidence });
    }
  }
  const information = Object.fromEntries(INFORMATION.map((name) => [name, cases.filter((entry) => entry.information === name).length]));

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

  return { configs, tiers, cases, information, pairs, versions, warnings };
}

const emptyLadder = (extra = {}) => ({ suites: [], tiers: [], configs: [], information: {}, pairs: [], versions: [], warnings: [], problems: [], ...extra });

/**
 * state.ladder: every case of the suite versions the ladder report uses (the newest with counted
 * runs per suite), unrun cases included, each with its information class, and the pair table.
 * The only source the dashboard reads for the ladder. A root with no usable ladder gives no suites.
 * `suiteAt(id, version)` is buildState's cached suite load.
 */
export function ladderState(root, state, { suiteAt }) {
  let status;
  try {
    status = ladderStatus(root);
  } catch {
    return emptyLadder();
  }
  const diskVersions = new Map();
  for (const id of Object.values(status.ladder.suites)) {
    const version = suiteAt(id)?.version;
    if (version != null) diskVersions.set(id, String(version));
  }
  const frozenCopy = (id, version) => {
    const copy = suiteAt(id, version);
    return copy?.frozen ? { cases: copy.cases, sha256: copy.sha256 } : null;
  };
  let report;
  try {
    report = ladderReport({ state, ladder: status.ladder, ladderCases: status.cases, diskVersions, frozenCopy, keepOtherSuites: true });
  } catch (error) {
    return emptyLadder({ problems: status.problems, error: error.message });
  }
  const suites = Object.values(status.ladder.suites).map((id) => ({
    id,
    version: report.versions.find((item) => item.suite === id)?.version ?? diskVersions.get(id) ?? null,
    // Set when the suite's counted runs are not comparable: its cases then show no result.
    refused: report.versions.find((item) => item.suite === id)?.refused ?? null,
    cases: report.cases.filter((entry) => entry.suite === id),
  }));
  const { cases, ...rest } = report;
  return { suites, ...rest, problems: status.problems };
}
