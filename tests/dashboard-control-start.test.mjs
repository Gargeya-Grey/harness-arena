import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredPreset, oneCallSelection, rerunSelection } from '../dashboard/public/js/control-onboarding.js';
import { runRequest, selectionView } from '../dashboard/public/js/run-selection.js';

const preset = (overrides = {}) => ({
  id: 'answer-pilot', file: 'answer-pilot.yaml', suite: 'answer', repeats: 3, problems: [],
  case_ids: ['answer-one', 'answer-two'],
  targets: [
    { model: 'small', display_name: 'Small model', harness: 'first', effort: 'high', effort_levels: ['low', 'high'] },
    { model: 'small', display_name: 'Small model', harness: 'second', effort: 'high', effort_levels: ['low', 'high'] },
    { model: 'large', display_name: 'Large model', harness: 'second', effort: 'high', effort_levels: ['high'] },
  ], ...overrides,
});

test('a family choice retains its valid current preset and exposes unavailable families without crossing into another test', () => {
  const first = preset();
  const second = preset({ id: 'answer-wide', file: 'answer-wide.yaml' });
  const blocked = preset({ suite: 'pictures', file: 'pictures.yaml', problems: ['The model is unavailable.'] });
  const catalog = { experiments: [first, second, blocked] };
  assert.equal(preferredPreset(catalog, 'answer', second.file), second);
  assert.equal(preferredPreset(catalog, 'pictures'), blocked);
  assert.equal(preferredPreset(catalog, 'unknown'), null);
});

test('preparing one call keeps one exact preset model, harness and case and never returns a start request', () => {
  const e = preset();
  const selection = oneCallSelection(e);
  assert.equal(selectionView(e, selection).calls, 1);
  assert.deepEqual(runRequest(e, selection, true), { command: 'run', experiment: e.file, harness: 'first', models: ['small'], cases: ['answer-one'], repeats: 1, dry_run: true });
  assert.equal(selection.effort, '');
});

test('a one-call preparation collapses an effort sweep using its named supported preset effort', () => {
  const e = preset({ targets: [
    { model: 'small', harness: 'first', effort: 'low', effort_levels: ['low', 'high'] },
    { model: 'small', harness: 'first', effort: 'high', effort_levels: ['low', 'high'] },
  ] });
  const selection = oneCallSelection(e);
  assert.equal(selection.effort, 'low');
  assert.equal(selectionView(e, selection).calls, 1);
  assert.equal(oneCallSelection(preset({ problems: ['Unavailable.'] })), null);
});

test('rerun prefill preserves exact filters and effort without starting a call', () => {
  const e = preset();
  const payload = { selection: { experiment: e.file, harness: 'second', models: ['large'], cases: ['answer-two'], repeats: 2, effort: 'high' } };
  const result = rerunSelection({ experiments: [e] }, payload);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(runRequest(e, result.selection, true), { ...payload.selection, command: 'run', dry_run: true });
});

test('stale reruns require a new explicit choice instead of dropping unavailable ids or broadening to all', () => {
  const e = preset();
  const selection = { experiment: e.file, harness: 'second', models: ['large'], cases: ['answer-two'], repeats: 1, effort: '' };
  const bad = [
    [{ experiment: 'gone.yaml' }, /preset.*available/i],
    [{ models: ['unknown', 'large'] }, /model.*unknown/i],
    [{ cases: ['gone', 'answer-two'] }, /case.*gone/i],
    [{ models: [] }, /model/i],
    [{ cases: [] }, /case/i],
    [{ harness: 'gone' }, /harness/i],
    [{ effort: 'low' }, /effort.*not supported/i],
    [{ repeats: 0 }, /tries/i],
  ];
  for (const [change, reason] of bad) {
    const result = rerunSelection({ experiments: [e] }, { selection: { ...selection, ...change } });
    assert.equal(result.selection, null, JSON.stringify(change));
    assert.match(result.problems.join(' '), reason);
  }
});
