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
    // As the runner records it: no flags means the harness loaded the user's setup.
    const { state } = setupEvidenceOf({ harness: { name: harness, settings: { user_config: flags.length ? 'isolated' : 'loaded', user_config_flags: flags } } });
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
        unproved_setup: isolated && (state === 'loaded' || state === 'unknown' || state === 'leaked'),
        label: `${model} · ${harness}${used ? ` · ${used}` : ''}`,
        planned_id: configId(model, { name: harness, version: 'unknown' }, used, state, answerTools),
      });
    }
  }
  return setups;
}

const qualityOf = (evaluators) => (evaluators || []).filter((item) => item.dimension === 'quality').map((item) => `${item.id}@${item.version}`).sort().join(' + ');

/**
 * The stored rows that can speak for this plan: rows of the chosen setups with the same suite version, suite content
 * (hash), prompt version and quality evaluators as the plan. Runs of any other setup are not looked at, so they cannot
 * affect the report. `blocked` is set when the plan cannot produce a comparable score. `notes` says what was left out.
 */
function usableHistory(state, plan, setups) {
  const plannedQuality = qualityOf(plan.experiment.evaluators);
  if (!plannedQuality) return { rows: [], blocked: 'The experiment has no quality evaluator, so its results cannot show which setup solves more tasks.', notes: [] };
  const contextOf = new Map(state.contexts.map((ctx) => [ctx.key, ctx]));
  const runOf = new Map(state.runs.map((run) => [run.run_id, run]));
  const chosen = new Set(setups.map((setup) => `${setup.model}\0${setup.harness}\0${setup.effort ?? ''}`));
  const isChosen = (row) => {
    const config = state.configs[row.config_id];
    return config && chosen.has(`${config.model_key}\0${config.harness.name}\0${config.effort ?? ''}`);
  };
  const version = String(plan.suite.version);
  const label = `${plan.suite.id}@${version}`;
  const plannedPrompt = `${plan.prompt.id}@${plan.prompt.version}`;
  const notes = [];
  const byRun = new Map();
  for (const row of state.observations) {
    const ctx = contextOf.get(row.context_key);
    if (row.trusted === false || ctx?.suite?.id !== plan.suite.id || String(ctx.suite.version) !== version || !qualityOf(ctx.evaluators) || !isChosen(row)) continue;
    if (!byRun.has(row.run_id)) byRun.set(row.run_id, []);
    byRun.get(row.run_id).push(row);
  }
  const keep = [];
  const changed = [];
  const otherPrompts = new Set();
  const otherEvaluators = new Set();
  for (const [id, rows] of byRun) {
    const ctx = contextOf.get(rows[0].context_key);
    const counted = countedRows(rows, true).length > 0;
    const prompt = `${ctx.prompt.id}@${ctx.prompt.version}`;
    if (runOf.get(id)?.suite?.sha256 !== plan.suite.sha256) changed.push(id);
    else if (prompt !== plannedPrompt) { if (counted) otherPrompts.add(prompt); }
    else if (qualityOf(ctx.evaluators) !== plannedQuality) { if (counted) otherEvaluators.add(qualityOf(ctx.evaluators)); }
    else keep.push(id);
  }
  if (changed.length) notes.push(`${count(changed.length, 'stored run')} of ${plan.suite.id} ${version} recorded other suite content than the suite now has (it changed without a new version), so ${changed.length === 1 ? 'it is' : 'they are'} not used.`);
  if (otherPrompts.size) notes.push(`Stored runs of ${label} used prompt ${[...otherPrompts].sort().join(', ')}; this experiment uses ${plannedPrompt}. Scores of different prompts are not comparable, so they are not used.`);
  if (otherEvaluators.size) notes.push(`Stored runs of ${label} were scored with ${[...otherEvaluators].sort().join(', ')}; this experiment uses ${plannedQuality}. Scores of different evaluator versions are not comparable, so they are not used.`);
  if (!keep.some((id) => countedRows(byRun.get(id), true).length > 0)) {
    const others = [...new Set(state.observations.filter((row) => row.trusted !== false && row.run_scored && contextOf.get(row.context_key)?.suite?.id === plan.suite.id && String(contextOf.get(row.context_key).suite.version) !== version).map((row) => String(contextOf.get(row.context_key).suite.version)))].sort(compareVersions);
    if (others.length) notes.push(`No counted run of ${label} is stored. Counted runs of ${others.join(', ')} are not used: a task reworked under the same id in a new version is a different measurement.`);
  }
  return { rows: keep.flatMap((id) => byRun.get(id)), blocked: null, notes };
}

/** Each setup's stored configuration: same model, harness, effort, answer tools and setup state, with usable rows. */
function matchHistory(setups, state, rows) {
  const rowsOf = new Map();
  for (const row of rows) {
    if (!rowsOf.has(row.config_id)) rowsOf.set(row.config_id, []);
    rowsOf.get(row.config_id).push(row);
  }
  return setups.map((setup) => {
    // History is a counted result: a configuration whose rows are all lost errors has none.
    const same = Object.values(state.configs).filter(
      (config) => config.model_key === setup.model && config.harness.name === setup.harness && (config.effort ?? null) === (setup.effort ?? null) && rowsOf.has(config.id) && countedRows(rowsOf.get(config.id), true).length > 0,
    );
    const own = same.filter((config) => config.setup_state === setup.setup_state && config.answer_tools === setup.answer_tools).sort((a, b) => String(b.latest_run_at).localeCompare(String(a.latest_run_at)));
    const chosen = own[0] ?? null;
    return {
      ...setup,
      config_id: chosen?.id ?? setup.planned_id,
      has_history: Boolean(chosen),
      history_version: chosen?.harness.version ?? null,
      history_label: chosen?.short_label ?? setup.label,
      rows: chosen ? rowsOf.get(chosen.id) : [],
      other_harness_versions: own.slice(1).map((config) => config.id),
      // Never pooled: the same model and harness under another setup state or with other answer tools.
      excluded: same
        .filter((config) => !own.includes(config))
        .map((config) => ({ config_id: config.id, setup_state: config.setup_state, answer_tools: config.answer_tools, differs: [config.setup_state !== setup.setup_state ? config.setup_state : null, config.answer_tools !== setup.answer_tools ? `answer tools ${config.answer_tools}` : null].filter(Boolean).join(', ') })),
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

/** What the audit stored for the planned tasks of this exact suite content (reports/audit/<suite>@<version>.json). */
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
  const wanted = new Set(plan.cases.map((item) => item.case_id));
  const audited = (Array.isArray(report.tasks) ? report.tasks : []).filter((item) => wanted.has(item.case_id) && item.status === 'audited');
  if (!audited.length) return { ...none, no_coverage: true };
  const mutants = audited.reduce((sum, item) => sum + (item.mutants || 0), 0);
  const killed = audited.reduce((sum, item) => sum + (item.killed || 0), 0);
  return { state: audited.length === wanted.size ? 'audited' : 'partly audited', kill_rate: mutants ? round(killed / mutants) : null, audited_tasks: audited.length, tasks: wanted.size };
}

function pairOf(a, b, cases, planned) {
  const evidence = a.has_history && b.has_history ? pairEvidence(cases, a.config_id, b.config_id) : { shared: 0, a_only: 0, b_only: 0, sign_p: 1 };
  const unseen = planned - evidence.shared;
  const larger = Math.max(evidence.a_only, evidence.b_only);
  const smaller = Math.min(evidence.a_only, evidence.b_only);
  const unproved = [a, b].filter((setup) => setup.unproved_setup);
  let status = 'open';
  if (unproved.length || a.setup_state !== b.setup_state) status = 'confounded';
  // The one bound that does not depend on history: too few tasks. Anything else is a prediction from stored results.
  else if (planned < NEEDED) status = 'unreachable';
  else if (evidence.shared && evidence.sign_p < ALPHA) status = 'reachable';
  else if (signTestP(larger + unseen, smaller) >= ALPHA) status = 'unlikely';
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
  const split = `${count(pair.a_only, 'task')} only ${pair.a_label} solved, ${count(pair.b_only, 'task')} only ${pair.b_label} solved`;
  if (pair.status === 'confounded') {
    return pair.setup_states[0] === pair.setup_states[1]
      ? `${names}: a setup that cannot be shown to stay out may carry your own setup, so this pair cannot give a clean signal.`
      : `${names}: one is ${pair.setup_states[0]} and the other ${pair.setup_states[1]}, so a difference may come from your own setup. This pair cannot give a clean signal.`;
  }
  if (!pair.shared) return `${names}: no planned task has history for both, so no disagreement can be predicted.`;
  const head = `${names}: ${count(pair.shared, 'shared task')} with history, ${split}.`;
  if (pair.status === 'reachable') return `${head} That pattern gives p ${pair.sign_p}, under ${ALPHA}.`;
  if (pair.status === 'unlikely') return `${head} ${pair.unseen ? `Even if ${count(pair.unseen, 'task')} without history all went one way, p would be ${pair.best_case_p}` : `On these stored results p is ${pair.best_case_p}`}, over ${ALPHA}. This is a prediction: a new run can differ.`;
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
  const history = usableHistory(state, plan, setups);
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
  if (history.blocked) {
    result = 'unknown';
    reasons.push(history.blocked);
  } else if (!plannedCalls) {
    result = 'low signal';
    reasons.push('The experiment plans 0 calls, so a run cannot show anything.');
  } else if (lowCalls === plannedCalls) {
    result = 'low signal';
    reasons.push(`Every one of the ${count(plannedCalls, 'planned call')} repeats a task that every chosen setup already solved. History shows no difference, so a new run will probably add little.`);
  } else if (matched.length < 2) {
    result = 'unknown';
    reasons.push('One setup is planned, so there is no pair to compare. This check judges comparisons between setups.');
  } else if (pairs.some((pair) => pair.status === 'reachable')) {
    result = 'worth running';
  } else if (pairs.every((pair) => ['unreachable', 'unlikely', 'confounded'].includes(pair.status))) {
    result = 'low signal';
  } else {
    result = 'unknown';
  }
  if (!history.blocked && plannedCalls && lowCalls && lowCalls !== plannedCalls) reasons.push(`${count(lowCalls, 'planned call')} repeat${lowCalls === 1 ? 's' : ''} a task that every chosen setup already solved.`);
  if (!history.blocked && plannedCalls && lowCalls !== plannedCalls && matched.length >= 2) {
    if (plan.cases.length < NEEDED) {
      reasons.push(`The plan has ${count(plan.cases.length, 'task')}. Two setups need at least ${NEEDED} tasks that one solves and the other does not, so no pair can reach p under ${ALPHA}.`);
    } else {
      const withEvidence = pairs.filter((pair) => pair.shared || pair.status !== 'open');
      const byStatus = Object.fromEntries(['reachable', 'open', 'unlikely', 'confounded'].map((name) => [name, pairs.filter((pair) => pair.status === name).length]));
      if (pairs.length > 3 && withEvidence.length) reasons.push(`${count(pairs.length, 'pair')}: history predicts p under ${ALPHA} for ${byStatus.reachable} and not for ${byStatus.unlikely}, ${byStatus.confounded} cannot be compared cleanly, ${byStatus.open} are open.`);
      const order = ['reachable', 'open', 'confounded', 'unlikely'];
      // In a long list the summary line and the setup flag already name the unclean pairs.
      const explained = withEvidence.filter((pair) => pairs.length <= 3 || pair.status !== 'confounded');
      for (const pair of explained.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)).slice(0, 3)) reasons.push(pairReason(pair));
    }
  }
  if (!history.blocked) {
    const without = matched.filter((setup) => !setup.has_history);
    if (without.length) reasons.push(`${count(without.length, 'setup')} of ${matched.length} ${without.length === 1 ? 'has' : 'have'} no history for ${plan.suite.id}@${plan.suite.version} in the planned setup state: ${without.map((setup) => `${setup.label} (${setup.setup_state})`).join(', ')}.`);
    for (const setup of without.filter((item) => item.excluded.length)) {
      reasons.push(`${setup.label}: stored runs exist only as ${[...new Set(setup.excluded.map((item) => item.differs))].join(' and ')}. They are never pooled with the planned setup (${setup.setup_state}, answer tools ${setup.answer_tools}).`);
    }
    for (const setup of matched.filter((item) => item.other_harness_versions.length)) {
      reasons.push(`${setup.label}: history is from ${setup.config_id}; ${count(setup.other_harness_versions.length, 'other harness version')} ${setup.other_harness_versions.length === 1 ? 'is' : 'are'} not pooled.`);
    }
    for (const setup of matched.filter((item) => item.unproved_setup)) {
      reasons.push(`${setup.label} was asked to stay out of your setup, but the lab cannot show that it does. Its results may carry your own setup.`);
    }
    for (const setup of matched.filter((item) => item.setup_state === 'partly kept out')) {
      reasons.push(`${setup.label} can be only partly kept out of your setup. Its results may carry part of it, so a comparison with a setup fully kept out is not clean.`);
    }
    const versions = [...new Set(matched.filter((setup) => setup.has_history).map((setup) => `${setup.harness} ${setup.history_version}`))].sort();
    if (versions.length) reasons.push(`History is from ${versions.join(', ')}. The harness versions installed now were not checked, and a different version can behave differently.`);
  }
  reasons.push(...history.notes);
  const caught = checks.kill_rate == null ? '' : `: they caught ${Math.round(checks.kill_rate * 100)}% of the wrong answers made for the audit`;
  if (checks.state === 'audited') reasons.push(`The hidden checks are audited${caught}.`);
  else if (checks.state === 'partly audited') reasons.push(`The hidden checks of ${checks.audited_tasks} of ${checks.tasks} planned tasks are audited${caught}.`);
  else if (checks.no_coverage) reasons.push('The stored audit of the hidden checks covers none of the planned tasks, so these checks read as not audited.');
  else reasons.push(checks.stale ? 'The stored audit of the hidden checks is for other suite content, so these checks read as not audited.' : 'The hidden checks are not audited: nobody has tested whether they catch a wrong answer.');
  if (result === 'worth running' && tasks.no_history) reasons.push(`${count(tasks.no_history, 'task')} ${tasks.no_history === 1 ? 'has' : 'have'} no history, so the estimate rests on the others.`);

  return {
    planned_calls: plannedCalls,
    tasks,
    // null when no planned task has history: the count is unknown, not zero.
    calls_low_information: plan.cases.length && tasks.no_history === plan.cases.length ? null : lowCalls,
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
  if ('targets' in query) {
    try { options.targets = JSON.parse(query.targets); }
    catch { throw bad('Invalid setup selection'); }
  }
  if (query.effort !== undefined && query.effort !== '') options.effort = query.effort;
  const harnesses = list(query.harness, 'harness name');
  if (harnesses.length > 1) throw bad('Name one harness');
  if (harnesses.length) [options.harness] = harnesses;
  const models = list(query.models, 'model key');
  if ('models' in query && !models.length) throw bad('Select at least one model');
  if (models.length) options.models = models;
  const cases = list(query.cases, 'case id');
  if ('cases' in query && !cases.length) throw bad('Select at least one case');
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
