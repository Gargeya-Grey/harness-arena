import fs from 'node:fs';
import path from 'node:path';
import { findRunDir, loadCases, paths } from '../lab/lib/repo.mjs';
import { planExperiment } from '../lab/commands/run.mjs';
import { catalog } from './jobs.mjs';

const problem = (message, status = 400) => Object.assign(new Error(message), { status });

/** A new plan using current inputs. Reading it starts no job and writes no evidence. */
export function prepareRerun(root, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][\w.-]{0,239}$/.test(id)) throw problem('Choose an exact run ID');
  const dir = findRunDir(root, id);
  if (!dir) throw problem('That run is no longer available. Choose tests to prepare a new run.', 404);
  const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const presets = catalog(root).experiments.filter(item => item.id === run.experiment?.id && item.suite === run.suite?.id);
  if (presets.length !== 1) throw problem('The source preset is no longer active. Choose a current test family and setup.');
  const preset = presets[0];
  const models = [...new Set((run.models || []).map(item => item.model_key))];
  const harness = run.harness?.name;
  if (!models.length || models.some(model => !preset.targets.some(target => target.model === model && target.harness === harness))) throw problem('The source models or harness are no longer offered by this preset. Choose a current setup.');
  const levels = [...new Set(run.models.map(item => item.reasoning_effort))];
  if (levels.length !== 1 || !levels[0] || levels[0] === 'default') throw problem('This historical run has no single explicit effort. Choose an effort for a new run.');
  const cases = run.experiment.cases ?? loadCases(root, run.suite.id, run.suite.version).map(item => item.case_id);
  if (!Array.isArray(cases) || !cases.length) throw problem('The original test selection is unavailable. Choose tests for a new run.');
  const selection = { experiment: preset.file, harness, models, cases, repeats: run.repeats, effort: levels[0] };
  try { planExperiment(root, path.join(paths(root).experiments, preset.file), selection); }
  catch (error) { throw problem(`This selection cannot run with current inputs: ${error.message}`); }
  return { selection, source: { run_id: id, suite: run.suite, harness: run.harness?.name, harness_version: run.harness?.version }, note: 'Selection prepared only. A new run uses the current test definitions and installed harness. Preview it before starting.' };
}
