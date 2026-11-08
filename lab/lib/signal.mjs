// signalReport: before a run, can it give a trustable signal? It reads the stored runs of the same
// suite version and says so in three words: worth running, low signal or unknown.
//
// The report is an estimate from stored runs. It calls no model and writes nothing. A tier is an
// estimate label too, so no tier appears here.
//
// A setup is one model through one harness at one effort with one setup state (loaded, kept out,
// partly kept out, unknown). History is never pooled across setup states: a run that leaked the
// user's setup is not history for a setup that keeps it out.

import fs from 'node:fs';
import path from 'node:path';
import { buildState, configId, answerToolsOf, setupEvidenceOf, countedRows } from './state.mjs';
import { compareVersions, pairEvidence, signTestP, taskInformation } from './ladder.mjs';
import { effectiveEffort, paths } from './repo.mjs';
import { getAdapter } from '../adapters/index.mjs';
import { accessSettings, planExperiment } from '../commands/run.mjs';

export const ALPHA = 0.05;
const EPS = 1e-9;
const SAFE_ID = /^[A-Za-z0-9][\w.:@/+-]*$/;
const EXPERIMENT_FILE = /^[A-Za-z0-9][\w.-]*\.ya?ml$/;

/** The fewest disagreements, all one way, that give a two-sided exact sign test p under alpha. */
export function disagreementsNeeded(alpha = ALPHA) {
  let n = 1;
  while (signTestP(n, 0) >= alpha) n += 1;
  return n;
}

export const NEEDED = disagreementsNeeded();

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round = (value, digits = 5) => (value == null ? null : Number(value.toFixed(digits)));
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The setups the experiment would run, each with the setup state its current harness flags would give. */
function plannedSetups(root, plan) {
  const isolated = plan.userConfig === 'isolated';
  const setups = [];
  for (const { harness, effort, models } of plan.groups.values()) {
    const adapter = getAdapter(harness, root);
    const flags = isolated ? adapter.isolation?.args || [] : [];
    const { state } = setupEvidenceOf({ harness: { name: harness, settings: { user_config: isolated ? 'isolated' : 'loaded', user_config_flags: flags } } });
    const answerTools = answerToolsOf({ harness: { settings: { access: plan.access, ...accessSettings(adapter, plan.access) } } });
    for (const model of models) {
      const used = effectiveEffort({ effort }, plan.registry[model], adapter);
      setups.push({
        model,
        harness,
        effort: used,
        setup_state: state,
        answer_tools: answerTools,
        // Asked to stay out, and the lab cannot show that it did.
        unproved_setup: isolated && state === 'unknown',
        label: `${model} · ${harness}${used ? ` · ${used}` : ''}`,
        planned_id: configId(model, { name: harness, version: 'unknown' }, used, state, answerTools),
      });
    }
  }
  return setups;
}

/**
 * The stored rows that can speak for this plan: counted-or-not rows of the same suite version, the same suite
 * content (hash) and the same prompt version. `refused` is set when the counted runs mix prompt versions or
 * quality evaluator versions, as the ladder report refuses them. `notes` says what was left out and why.
 */
function usableHistory(state, plan) {
  const contextOf = new Map(state.contexts.map((ctx) => [ctx.key, ctx]));
  const runOf = new Map(state.runs.map((run) => [run.run_id, run]));
  const version = String(plan.suite.version);
  const notes = [];
  const rows = state.observations.filter((row) => {
    const ctx = contextOf.get(row.context_key);
    return row.trusted !== false && ctx?.suite?.id === plan.suite.id && String(ctx.suite.version) === version && (ctx.evaluators || []).some((item) => item.dimension === 'quality');
  });
  const byRun = new Map();
  for (const row of rows) {
    if (!byRun.has(row.run_id)) byRun.set(row.run_id, []);
    byRun.get(row.run_id).push(row);
  }
  const keep = new Set();
  const changed = [];
  for (const [id, runRows] of byRun) {
    if (runOf.get(id)?.suite?.sha256 !== plan.suite.sha256) changed.push(id);
    else keep.add(id);
  }
  if (changed.length) notes.push(`${count(changed.length, 'stored run')} of ${plan.suite.id} ${version} recorded other suite content than the suite now has (it changed without a new version), so ${changed.length === 1 ? 'it is' : 'they are'} not used.`);
  const counted = [...keep].filter((id) => countedRows(byRun.get(id), true).length > 0);
  if (!counted.length) {
    const others = [...new Set(state.observations.filter((row) => row.trusted !== false && row.run_scored && contextOf.get(row.context_key)?.suite?.id === plan.suite.id && String(contextOf.get(row.context_key).suite.version) !== version).map((row) => String(contextOf.get(row.context_key).suite.version)))].sort(compareVersions);
    if (others.length) notes.push(`No counted run of ${plan.suite.id}@${version} is stored. Counted runs of ${others.join(', ')} are not used: a task reworked under the same id in a new version is a different measurement.`);
  }
  const describe = (id) => {
    const ctx = contextOf.get(byRun.get(id)[0].context_key);
    return { prompt: `${ctx.prompt.id}@${ctx.prompt.version}`, evaluators: ctx.evaluators.filter((item) => item.dimension === 'quality').map((item) => `${item.id}@${item.version}`).sort().join(' + ') };
  };
  const prompts = [...new Set(counted.map((id) => describe(id).prompt))].sort();
  const evaluators = [...new Set(counted.map((id) => describe(id).evaluators))].sort();
  const label = `${plan.suite.id}@${version}`;
  let refused = null;
  if (prompts.length > 1) refused = `${label} has counted runs with different prompt versions (${prompts.join(', ')}); scores of different prompts are not comparable.`;
  else if (evaluators.length > 1) refused = `${label} has counted runs scored with different quality evaluator versions (${evaluators.join(', ')}); scores of different evaluator versions are not comparable.`;
  if (refused) return { rows: [], refused, notes };
  const planned = `${plan.prompt.id}@${plan.prompt.version}`;
  if (prompts.length === 1 && prompts[0] !== planned) {
    notes.push(`The stored runs of ${label} used prompt ${prompts[0]}; this experiment uses ${planned}. Scores of different prompts are not comparable, so they are not used.`);
    return { rows: [], refused: null, notes };
  }
  return { rows: rows.filter((row) => keep.has(row.run_id)), refused: null, notes };
}

/** Each setup's stored configuration: same model, harness, effort, answer tools and setup state, with usable rows. */
function matchHistory(setups, state, rows) {
  const rowsOf = new Map();
  for (const row of rows) {
    if (!rowsOf.has(row.config_id)) rowsOf.set(row.config_id, []);
    rowsOf.get(row.config_id).push(row);
  }
  return setups.map((setup) => {
    const same = Object.values(state.configs).filter(
      (config) => config.model_key === setup.model && config.harness.name === setup.harness && (config.effort ?? null) === (setup.effort ?? null) && config.answer_tools === setup.answer_tools && rowsOf.has(config.id),
    );
    const own = same.filter((config) => config.setup_state === setup.setup_state).sort((a, b) => String(b.latest_run_at).localeCompare(String(a.latest_run_at)));
    const chosen = own[0] ?? null;
    return {
      ...setup,
      config_id: chosen?.id ?? setup.planned_id,
      has_history: Boolean(chosen),
      history_label: chosen?.short_label ?? setup.label,
      rows: chosen ? rowsOf.get(chosen.id) : [],
      other_harness_versions: own.slice(1).map((config) => config.id),
      // Never pooled: the same setup under another setup state.
      excluded: same.filter((config) => config.setup_state !== setup.setup_state).map((config) => ({ config_id: config.id, setup_state: config.setup_state })),
    };
  });
}

/** case_id -> { solved, mean } for one configuration; a task is solved when its mean over the counted repeats is 1. */
function taskResults(rows) {
  const byCase = new Map();
  for (const row of countedRows(rows, true)) {
    if (!byCase.has(row.case_id)) byCase.set(row.case_id, []);
    byCase.get(row.case_id).push(row.value);
  }
  return new Map([...byCase].map(([id, values]) => {
    const value = values.reduce((sum, item) => sum + item, 0) / values.length;
    return [id, { mean: value, solved: value >= 1 - EPS }];
  }));
}

/**
 * The plan's task classes: no history, all solved, all unsolved or disagree. The ladder's classes map on purpose:
 *   no-data      -> no history
 *   one-config   -> with one chosen setup, all solved or all unsolved by its own result; with several chosen
 *                   setups, no history: one setup alone cannot agree or disagree with a partner
 *   all-solved / all-unsolved -> only when every chosen setup has a result, else no history
 *   disagree     -> disagree, whichever other setups have no result yet
 */
function taskClass(entries, chosen) {
  const info = taskInformation({ per_config: entries });
  if (info === 'disagree') return 'disagree';
  if (info === 'no-data') return 'no_history';
  if (entries.length < chosen) return 'no_history';
  if (info === 'one-config') return entries[0].solved ? 'all_solved' : 'all_unsolved';
  return info === 'all-solved' ? 'all_solved' : 'all_unsolved';
}

/** What the audit stored for this exact suite content (reports/audit/<suite>@<version>.json), or not audited. */
function checkQuality(root, plan) {
  const none = { state: 'not audited', kill_rate: null };
  const file = path.join(paths(root).reports, 'audit', `${plan.suite.id}@${plan.suite.version}.json`);
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return none;
  }
  if (report?.kind !== 'checks' || report.suite?.id !== plan.suite.id || String(report.suite?.version) !== String(plan.suite.version) || report.suite?.sha256 !== plan.suite.sha256) return { ...none, stale: true };
  const rate = report.totals?.kill_rate;
  return { state: 'audited', kill_rate: typeof rate === 'number' ? rate : null, audited_tasks: report.totals?.audited ?? null, tasks: report.totals?.tasks ?? null };
}

function pairOf(a, b, cases, planned) {
  const evidence = a.has_history && b.has_history ? pairEvidence(cases, a.config_id, b.config_id) : { shared: 0, a_only: 0, b_only: 0, sign_p: 1 };
  const unseen = planned - evidence.shared;
  const larger = Math.max(evidence.a_only, evidence.b_only);
  const smaller = Math.min(evidence.a_only, evidence.b_only);
  const unproved = [a, b].filter((setup) => setup.unproved_setup);
  let status = 'open';
  if (unproved.length) status = 'confounded';
  else if (evidence.shared && evidence.sign_p < ALPHA) status = 'reachable';
  else if (signTestP(larger + unseen, smaller) >= ALPHA) status = 'unreachable';
  return {
    a: a.config_id,
    b: b.config_id,
    predicted_disagreements: evidence.shared ? evidence.a_only + evidence.b_only : null,
    needed: NEEDED,
    a_label: a.label,
    b_label: b.label,
    shared: evidence.shared,
    a_only: evidence.a_only,
    b_only: evidence.b_only,
    unseen,
    sign_p: evidence.shared ? round(evidence.sign_p) : null,
    best_case_p: round(signTestP(larger + unseen, smaller)),
    status,
    setup_states: [a.setup_state, b.setup_state],
  };
}

function pairReason(pair) {
  const names = `${pair.a_label} against ${pair.b_label}`;
  const split = `${pair.a_only} only ${pair.a_label} solved, ${pair.b_only} only ${pair.b_label} solved`;
  if (pair.status === 'confounded') return `${names}: a setup that cannot be shown to stay out may carry your own setup, so this pair cannot give a clean signal.`;
  if (!pair.shared) return `${names}: no planned task has history for both, so no disagreement can be predicted.`;
  const head = `${names}: ${count(pair.shared, 'shared task')} with history, ${split}.`;
  if (pair.status === 'reachable') return `${head} That pattern gives p ${pair.sign_p}, under ${ALPHA}.`;
  if (pair.status === 'unreachable') return `${head} Even if ${count(pair.unseen, 'task')} without history all went one way, p would stay at ${pair.best_case_p}, over ${ALPHA}.`;
  return `${head} p ${pair.sign_p}. ${count(pair.unseen, 'task')} ${pair.unseen === 1 ? 'has' : 'have'} no history for both, so a run could still reach ${NEEDED} disagreements.`;
}

/**
 * signalReport(root, experiment, options) -> the report of Appendix E, plus fields the page and the command print.
 * `experiment` is the path of an experiment file. `options` narrows the plan as `node lab run` does:
 * { harness, models, cases, repeats }. Throws on a plan that `node lab run --dry-run` would refuse.
 */
export function signalReport(root, experiment, options = {}) {
  if (!experiment || !fs.existsSync(experiment) || !fs.statSync(experiment).isFile()) throw new Error(`No experiment file at ${experiment || '(none given)'}`);
  const plan = planExperiment(root, experiment, options);
  const state = buildState(root, { validate: false });
  const setups = plannedSetups(root, plan);
  const calls = plan.cases.length * plan.repeats;
  const plannedCalls = setups.length * calls;
  const history = usableHistory(state, plan);
  const matched = matchHistory(setups, state, history.rows);
  const results = new Map(matched.map((setup) => [setup.config_id, taskResults(setup.rows)]));

  const cases = plan.cases.map((item) => ({
    case_id: item.case_id,
    per_config: matched.filter((setup) => setup.has_history && results.get(setup.config_id).has(item.case_id)).map((setup) => ({ config_id: setup.config_id, ...results.get(setup.config_id).get(item.case_id) })),
  }));
  const taskList = cases.map((item) => ({ case_id: item.case_id, class: taskClass(item.per_config, matched.length) }));
  const tasks = { no_history: 0, all_solved: 0, all_unsolved: 0, disagree: 0 };
  for (const item of taskList) tasks[item.class] += 1;
  const lowCalls = tasks.all_solved * setups.length * plan.repeats;

  const outputTokens = matched.map((setup) => {
    const values = setup.rows.filter((row) => !row.error && typeof row.usage?.output_tokens === 'number').map((row) => row.usage.output_tokens);
    const perCall = median(values);
    return { config_id: setup.config_id, estimate: perCall == null ? null : Math.round(perCall * calls), median_per_call: perCall, stored_calls: values.length, planned_calls: calls };
  });

  const pairs = [];
  for (let i = 0; i < matched.length; i += 1) for (let j = i + 1; j < matched.length; j += 1) pairs.push(pairOf(matched[i], matched[j], cases, plan.cases.length));

  const checks = checkQuality(root, plan);
  const reasons = [];
  let result;
  if (history.refused) {
    result = 'unknown';
    reasons.push(`${history.refused} Its history is not used. Choose the runs with node lab ladder --runs, or run one prompt version.`);
  } else if (!plannedCalls) {
    result = 'low signal';
    reasons.push('The experiment plans 0 calls, so a run cannot show anything.');
  } else if (lowCalls === plannedCalls) {
    result = 'low signal';
    reasons.push(`Every one of the ${count(plannedCalls, 'planned call')} repeats a task that every chosen setup already solved. A new run cannot add information.`);
  } else if (matched.length < 2) {
    result = 'unknown';
    reasons.push('One setup is planned, so there is no pair to compare. This check judges comparisons between setups.');
  } else if (pairs.some((pair) => pair.status === 'reachable')) {
    result = 'worth running';
  } else if (pairs.every((pair) => pair.status === 'unreachable' || pair.status === 'confounded')) {
    result = 'low signal';
  } else {
    result = 'unknown';
  }
  if (!history.refused && plannedCalls && lowCalls && lowCalls !== plannedCalls) reasons.push(`${count(lowCalls, 'planned call')} repeat${lowCalls === 1 ? 's' : ''} a task that every chosen setup already solved.`);
  if (!history.refused && plannedCalls && lowCalls !== plannedCalls && matched.length >= 2) {
    const withEvidence = pairs.filter((pair) => pair.shared || pair.status === 'confounded');
    const byStatus = Object.fromEntries(['reachable', 'open', 'unreachable', 'confounded'].map((name) => [name, pairs.filter((pair) => pair.status === name).length]));
    if (pairs.length > 3 && withEvidence.length) reasons.push(`${count(pairs.length, 'pair')}: ${byStatus.reachable} can reach p under ${ALPHA} from history, ${byStatus.unreachable} cannot, ${byStatus.confounded} cannot be compared cleanly, ${byStatus.open} are open.`);
    const order = ['reachable', 'open', 'confounded', 'unreachable'];
    for (const pair of withEvidence.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)).slice(0, 3)) reasons.push(pairReason(pair));
  }
  if (!history.refused) {
    const without = matched.filter((setup) => !setup.has_history);
    if (without.length) reasons.push(`${count(without.length, 'setup')} of ${matched.length} ${without.length === 1 ? 'has' : 'have'} no history for ${plan.suite.id}@${plan.suite.version} in the planned setup state: ${without.map((setup) => `${setup.label} (${setup.setup_state})`).join(', ')}.`);
    for (const setup of without.filter((item) => item.excluded.length)) {
      reasons.push(`${setup.label}: stored runs exist only as ${[...new Set(setup.excluded.map((item) => item.setup_state))].join(' and ')}. They are never pooled with ${setup.setup_state}.`);
    }
    for (const setup of matched.filter((item) => item.other_harness_versions.length)) {
      reasons.push(`${setup.label}: history is from ${setup.config_id}; ${count(setup.other_harness_versions.length, 'other harness version')} ${setup.other_harness_versions.length === 1 ? 'is' : 'are'} not pooled.`);
    }
    for (const setup of matched.filter((item) => item.unproved_setup)) {
      reasons.push(`${setup.label} was asked to stay out of your setup, but the lab cannot show that it does. Its results may carry your own setup.`);
    }
  }
  reasons.push(...history.notes);
  if (checks.state === 'audited') reasons.push(`The hidden checks are audited${checks.kill_rate == null ? '' : `: they caught ${Math.round(checks.kill_rate * 100)}% of the wrong answers made for the audit`}.`);
  else reasons.push(checks.stale ? 'The stored audit of the hidden checks is for other suite content, so these checks read as not audited.' : 'The hidden checks are not audited: nobody has tested whether they catch a wrong answer.');
  if (result === 'worth running' && tasks.no_history) reasons.push(`${count(tasks.no_history, 'task')} ${tasks.no_history === 1 ? 'has' : 'have'} no history, so the estimate rests on the others.`);

  return {
    planned_calls: plannedCalls,
    tasks,
    calls_low_information: lowCalls,
    output_tokens: outputTokens,
    pairs,
    checks,
    setups: matched.map((setup) => ({ config_id: setup.config_id, setup_state: setup.setup_state, label: setup.label, history: setup.has_history, calls })),
    result,
    reasons,
    note: 'An estimate from stored runs of the same suite version. It calls no model and writes nothing.',
    experiment: { id: plan.experiment.id, suite: plan.suite.id, version: String(plan.suite.version), prompt: `${plan.prompt.id}@${plan.prompt.version}`, repeats: plan.repeats, tasks: plan.cases.length, setups: setups.length },
    task_list: taskList,
  };
}

/**
 * The dashboard's request: an experiment file name in experiments/ and the narrowing the Run page offers.
 * Anything else is refused with a 400 before a file is opened.
 */
export function signalForQuery(root, query) {
  const bad = (message) => Object.assign(new Error(message), { status: 400 });
  const file = String(query.experiment || '');
  if (!EXPERIMENT_FILE.test(file)) throw bad('Name an experiment file in experiments/, for example ladder-answer.yaml');
  const abs = path.join(paths(root).experiments, file);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw bad(`No experiment named ${file}`);
  const list = (value, label) => {
    const items = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    for (const item of items) if (!SAFE_ID.test(item) || item.length > 200) throw bad(`Not a valid ${label}: "${item.slice(0, 60)}"`);
    return items;
  };
  const options = {};
  if (query.harness) [options.harness] = list(query.harness, 'harness name');
  const models = list(query.models, 'model key');
  if (models.length) options.models = models;
  const cases = list(query.cases, 'case id');
  if (cases.length) options.cases = cases;
  if (query.repeats != null && query.repeats !== '') {
    const n = Number(query.repeats);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw bad('Repeats must be a whole number from 1 to 50');
    options.repeats = n;
  }
  try {
    return signalReport(root, abs, options);
  } catch (error) {
    throw Object.assign(error, { status: error.status || 400 });
  }
}
