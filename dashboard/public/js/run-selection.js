const distinct = (items) => [...new Set(items)];
const words = (value) => String(value || '').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const caseIds = (experiment) => experiment ? experiment.cases || experiment.case_ids || [] : [];
export const harnessesOf = (experiment) => distinct((experiment?.targets || []).map((target) => target.harness));
export const modelsOf = (experiment, harness = '') => distinct((experiment?.targets || []).filter((target) => !harness || target.harness === harness).map((target) => target.model));

export function experimentTitle(experiment) {
  const suite = experiment.suite || '';
  const suffix = experiment.id === suite ? '' : experiment.id.startsWith(`${suite}-`) ? experiment.id.slice(suite.length + 1) : experiment.id;
  const mode = suffix.replace(/repaired-explicit-effort/g, 'explicit effort').replace(/codex-installed/g, 'Codex installed setup');
  return [words(suite), words(mode || 'original preset')].filter(Boolean).join(' · ');
}

export function experimentMatches(experiment, query) {
  const haystack = [experimentTitle(experiment), experiment.id, experiment.file, experiment.suite, experiment.description, experiment.access, experiment.user_config,
    ...(experiment.targets || []).flatMap((target) => [target.model, target.harness, target.effort]), ...caseIds(experiment)].join(' ').toLowerCase();
  return String(query || '').toLowerCase().trim().split(/\s+/).every((word) => haystack.includes(word));
}

export function experimentProblems(experiment) {
  if (!experiment) return ['Choose an experiment.'];
  const problems = [...(experiment.problems || [])];
  if (!(experiment.targets || []).length) problems.push('This experiment has no resolved setups.');
  if (!caseIds(experiment).length) problems.push('This experiment has no cases.');
  return distinct(problems);
}

export function initialExperiment(experiments, remembered) {
  const valid = (experiment) => !experimentProblems(experiment).length;
  const saved = experiments.find((experiment) => experiment.file === remembered && valid(experiment));
  if (saved) return saved;
  const explicit = experiments.filter((experiment) => valid(experiment) && experiment.targets.every((target) => target.effort && target.effort !== 'default'));
  return explicit.find((experiment) => experiment.suite === 'smoke') || explicit[0] || null;
}

export function initialSelection(experiment) {
  return { exp: experiment?.file || null, harness: '', effort: '', models: new Set(modelsOf(experiment)), cases: new Set(caseIds(experiment)), repeats: '' };
}

export const effortLabel = (level) => ({ low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum', ultra: 'Ultra', unavailable: 'Unavailable', default: 'Default (historical)' }[level] || level);

export const pairKey = (target) => JSON.stringify([target.harness, target.model]);
const configurationKey = (target) => JSON.stringify([target.harness, target.model, target.effort]);
export const targetLevels = (target) => target.choices ?? (target.effort === 'unavailable' && !target.effort_levels?.length ? ['unavailable'] : target.effort_levels ?? []);

export function applySharedEffort(targets, effort) {
  return [...new Map(targets.map(target => [pairKey(target), { ...target, effort }])).values()];
}

export function effortLevels(experiment, selection) {
  const targets = selection.customTargets ?? (experiment?.targets || []).filter(target => (!selection.harness || target.harness === selection.harness) && selection.models.has(target.model));
  if (!targets.length) return [];
  return distinct(targetLevels(targets[0])).filter(level => targets.every(target => targetLevels(target).includes(level)));
}

export function selectionView(experiment, selection) {
  const models = modelsOf(experiment, selection.harness);
  const selectedModels = models.filter((model) => selection.models.has(model));
  const cases = caseIds(experiment).filter((id) => selection.cases.has(id));
  const selected = (experiment?.targets || []).filter((target) => (!selection.harness || selection.harness === target.harness) && selectedModels.includes(target.model));
  const targets = selection.customTargets ?? (selection.effort ? applySharedEffort(selected, selection.effort) : selected);
  const repeats = selection.repeats === '' ? experiment?.repeats ?? 1 : Number(selection.repeats);
  const problems = experimentProblems(experiment);
  if (selection.effort && !effortLevels(experiment, selection).includes(selection.effort)) problems.push('This effort is not supported by every selected setup. Choose another effort or narrow the models.');
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 50) problems.push('Tries must be a whole number from 1 to 50.');
  if (!targets.length) problems.push('Select at least one model setup.');
  if (selection.customTargets) {
    if (targets.some(target => !targetLevels(target).includes(target.effort))) problems.push('Choose a verified effort for each setup or remove that setup.');
    if (new Set(targets.map(configurationKey)).size !== targets.length) problems.push('Choose a different effort for the repeated setup or remove it.');
  }
  if (!cases.length) problems.push('Select at least one case.');
  const valid = problems.length === 0;
  return { models, selectedModels, targets, cases, repeats, problems, valid, calls: valid ? targets.length * cases.length * repeats : 0 };
}

export function runRequest(experiment, selection, dry = false) {
  const view = selectionView(experiment, selection);
  if (!view.valid) return null;
  if (selection.customTargets) {
    const targets = view.targets.map(({ model, harness, effort }) => ({ model, harness, effort }));
    return { command: 'run', experiment: experiment.file, dry_run: dry, targets, cases: view.cases, repeats: view.repeats };
  }
  return { command: 'run', experiment: experiment.file, dry_run: dry, ...(selection.harness ? { harness: selection.harness } : {}), ...(selection.effort ? { effort: selection.effort } : {}), models: view.selectedModels, cases: view.cases, repeats: view.repeats };
}

export function signalQuery(experiment, selection) {
  const body = runRequest(experiment, selection);
  if (!body) return null;
  const query = new URLSearchParams({ experiment: body.experiment, cases: body.cases.join(','), repeats: String(body.repeats) });
  if (body.targets) query.set('targets', JSON.stringify(body.targets));
  else query.set('models', body.models.join(','));
  if (body.harness) query.set('harness', body.harness);
  if (body.effort) query.set('effort', body.effort);
  return query;
}
