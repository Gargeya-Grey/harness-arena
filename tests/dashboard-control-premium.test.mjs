import test from 'node:test';
import assert from 'node:assert/strict';
import { caseIds, experimentTitle, experimentMatches, initialExperiment, initialSelection, selectionView, runRequest, signalQuery } from '../dashboard/public/js/run-selection.js';

const experiment = (overrides = {}) => ({
  id: 'sample-guided-explicit-effort', file: 'sample-guided-explicit-effort.yaml', suite: 'sample', description: 'Guided apartment with reversible walls.',
  repeats: 3, problems: [], cases: null, case_ids: ['sample-one', 'sample-two'], user_config: 'isolated',
  targets: [
    { model: 'small', harness: 'codex', effort: 'high' },
    { model: 'small', harness: 'claude-code', effort: 'high' },
    { model: 'large', harness: 'claude-code', effort: 'medium' },
  ], ...overrides,
});

test('initial inclusion matches every effective setup and case, including several harnesses for one model', () => {
  const e = experiment();
  const selection = initialSelection(e);
  const view = selectionView(e, selection);
  assert.deepEqual([...selection.models], ['small', 'large']);
  assert.deepEqual([...selection.cases], e.case_ids);
  assert.equal(view.calls, 18);
  assert.equal(view.targets.length, 3);
  assert.equal(view.valid, true);
  const body = runRequest(e, selection, true);
  assert.deepEqual(body, { command: 'run', experiment: e.file, dry_run: true, models: ['small', 'large'], cases: e.case_ids, repeats: 3 });
  assert.deepEqual(Object.fromEntries(signalQuery(e, selection)), { experiment: e.file, models: 'small,large', cases: 'sample-one,sample-two', repeats: '3' });
});

for (const kind of ['models', 'cases']) {
  test(`clearing the last ${kind} is invalid and cannot produce a job or broadened signal request`, () => {
    const e = experiment();
    const selection = initialSelection(e);
    selection[kind].clear();
    const view = selectionView(e, selection);
    assert.equal(view.valid, false);
    assert.equal(view.calls, 0);
    assert.match(view.problems[0], kind === 'models' ? /at least one model/ : /at least one case/);
    assert.equal(runRequest(e, selection, true), null);
    assert.equal(runRequest(e, selection, false), null);
    assert.equal(signalQuery(e, selection), null);
  });
}

test('harness filtering preserves selection and never substitutes other models when it excludes the last chosen model', () => {
  const e = experiment();
  const selection = initialSelection(e);
  selection.models = new Set(['large']);
  selection.harness = 'codex';
  assert.equal(selectionView(e, selection).calls, 0);
  assert.equal(runRequest(e, selection), null);
  assert.equal(signalQuery(e, selection), null);
  assert.deepEqual([...selection.models], ['large']);
  selection.harness = 'claude-code';
  assert.equal(selectionView(e, selection).calls, 6);
  assert.deepEqual(runRequest(e, selection).models, ['large']);
  selection.harness = '';
  assert.equal(selectionView(e, selection).calls, 6);
});

test('a narrowed Preview and its signal name exactly the visible included models, cases, harness and repeats', () => {
  const e = experiment();
  const selection = initialSelection(e);
  selection.harness = 'claude-code';
  selection.models.delete('large');
  selection.cases.delete('sample-one');
  selection.repeats = '1';
  const view = selectionView(e, selection);
  assert.equal(view.calls, 1);
  const body = runRequest(e, selection, true);
  assert.deepEqual(body, { command: 'run', experiment: e.file, dry_run: true, harness: 'claude-code', models: ['small'], cases: ['sample-two'], repeats: 1 });
  const query = signalQuery(e, selection);
  for (const field of ['experiment', 'harness', 'repeats']) assert.equal(query.get(field), String(body[field]));
  assert.equal(query.get('models'), body.models.join(','));
  assert.equal(query.get('cases'), body.cases.join(','));
});

test('preset cases bound inclusion and stale model/case ids never expand a request', () => {
  const e = experiment({ cases: ['sample-two'] });
  const selection = initialSelection(e);
  assert.deepEqual(caseIds(e), ['sample-two']);
  assert.deepEqual([...selection.cases], ['sample-two']);
  selection.models = new Set(['missing']);
  selection.cases = new Set(['sample-one']);
  assert.equal(runRequest(e, selection), null);
  assert.equal(signalQuery(e, selection), null);
});

test('catalog problems and invalid repeats disable planning instead of claiming availability from the filename', () => {
  const e = experiment({ problems: ['Effort high is unsupported by this model.'] });
  const selection = initialSelection(e);
  assert.equal(selectionView(e, selection).valid, false);
  assert.equal(runRequest(e, selection), null);
  assert.equal(signalQuery(e, selection), null);
  for (const repeats of ['0', '51', '1.5', 'bad']) {
    selection.repeats = repeats;
    const clean = experiment();
    assert.equal(selectionView(clean, selection).valid, false);
    assert.equal(runRequest(clean, selection), null);
  }
});

test('a valid remembered preset wins; fallback uses resolved explicit effort and actual catalog validity', () => {
  const remembered = experiment({ file: 'remembered.yaml', targets: [{ model: 'small', harness: 'codex', effort: null }] });
  const invalid = experiment({ file: 'looks-explicit.yaml', problems: ['Registry mismatch.'] });
  const implicit = experiment({ file: 'implicit.yaml', targets: [{ model: 'small', harness: 'codex', effort: null }] });
  const valid = experiment({ file: 'valid.yaml' });
  const smoke = experiment({ file: 'smoke.yaml', suite: 'smoke' });
  const experiments = [invalid, implicit, remembered, valid, smoke];
  assert.equal(initialExperiment(experiments, 'remembered.yaml'), remembered);
  assert.equal(initialExperiment(experiments, 'looks-explicit.yaml'), smoke);
  assert.equal(initialExperiment(experiments, 'removed.yaml'), smoke);
  assert.equal(initialExperiment([implicit, invalid], null), null);
});

test('experiment labels distinguish guided and scrubbable modes and search accepts exact ids, suite and description', () => {
  const guided = experiment({ id: 'sample-guided-repaired-explicit-effort' });
  const scrubbable = experiment({ id: 'sample-scrubbable-repaired-explicit-effort' });
  assert.notEqual(experimentTitle(guided), experimentTitle(scrubbable));
  assert.match(experimentTitle(guided), /Guided/);
  for (const query of ['sample-guided-repaired-explicit-effort', 'sample', 'guided', 'reversible walls', 'codex high']) assert.equal(experimentMatches(guided, query), true, query);
  assert.equal(experimentMatches(guided, 'scrubbable'), false);
  const selection = initialSelection(guided);
  assert.equal(experimentMatches(guided, 'no matching description'), false);
  assert.deepEqual(runRequest(guided, selection), runRequest(guided, initialSelection(guided)));
});
