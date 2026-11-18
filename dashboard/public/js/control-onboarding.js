import { caseIds, harnessesOf, modelsOf, experimentProblems, initialExperiment, initialSelection, effortLevels, selectionView, pairKey } from './run-selection.js';

export function preferredPreset(catalog, suite, current = '') {
  const presets = (catalog?.experiments || []).filter(experiment => experiment.suite === suite);
  return initialExperiment(presets, current) || presets[0] || null;
}

export function oneCallSelection(experiment) {
  if (experimentProblems(experiment).length) return null;
  for (const target of experiment.targets) {
    const selection = initialSelection(experiment);
    selection.harness = target.harness;
    selection.models = new Set([target.model]);
    selection.cases = new Set(caseIds(experiment).slice(0, 1));
    selection.repeats = '1';
    if (selectionView(experiment, selection).calls > 1 && effortLevels(experiment, selection).includes(target.effort)) selection.effort = target.effort;
    if (selectionView(experiment, selection).calls === 1) return selection;
  }
  return null;
}

export function rerunSelection(catalog, payload) {
  const request = payload?.selection;
  const experiment = catalog?.experiments?.find(item => item.file === request?.experiment);
  if (!experiment) return { selection: null, problems: ['The original preset is no longer available. Choose a test and preset below.'] };
  const problems = [...experimentProblems(experiment)];
  const harness = request.harness || '';
  if (harness && !harnessesOf(experiment).includes(harness)) problems.push(`The original harness ${harness} is not in this preset.`);
  const fields = [['cases', caseIds(experiment), 'case']];
  if (!request.targets) fields.push(['models', modelsOf(experiment, harness), 'model']);
  for (const [field, available, label] of fields) {
    const values = request[field];
    if (!Array.isArray(values) || !values.length) problems.push(`The original run has no available ${label} selection.`);
    else for (const value of values) if (!available.includes(value)) problems.push(`The original ${label} ${value} is no longer available in this preset.`);
  }
  const selection = { exp: experiment.file, harness, effort: request.effort || '', models: new Set(request.models || []), cases: new Set(request.cases || []), repeats: String(request.repeats ?? '') };
  if (request.targets) {
    selection.customTargets = request.targets.flatMap(target => {
      const setup = catalog.setups?.find(item => pairKey(item) === pairKey(target));
      if (!setup) {
        problems.push(`The original model ${target.model} on ${target.harness} is no longer available.`);
        return [];
      }
      return [{ ...setup, effort: target.effort }];
    });
  }
  problems.push(...selectionView(experiment, selection).problems);
  return { selection: problems.length ? null : selection, problems: [...new Set(problems)] };
}
