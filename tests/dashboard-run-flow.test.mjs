import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSelection,selectionView,runRequest,signalQuery,effortLevels} from '../dashboard/public/js/run-selection.js';

const preset={file:'test.yaml',id:'test',repeats:1,cases:['one','two'],problems:[],targets:[
  {model:'alpha',harness:'codex',effort:'high',effort_levels:['low','high','max']},
  {model:'beta',harness:'claude-code',effort:'high',effort_levels:['low','high']},
]};
test('thinking effort uses the intersection of selected setup capabilities and the same value reaches Preview, Start and signal',()=>{
  const selection=initialSelection(preset);
  assert.deepEqual(effortLevels(preset,selection),['low','high']);
  selection.effort='low';
  assert.equal(selectionView(preset,selection).calls,4);
  assert(selectionView(preset,selection).targets.every(t=>t.effort==='low'));
  assert.equal(runRequest(preset,selection,true).effort,'low');
  assert.equal(signalQuery(preset,selection).get('effort'),'low');
  selection.effort='max';
  assert.equal(runRequest(preset,selection),null);
  selection.models.delete('beta');
  assert.equal(runRequest(preset,selection).effort,'max');
});
test('a chosen effort collapses a preset effort sweep to one configuration per model and harness',()=>{
  const sweep={...preset,targets:[{...preset.targets[0],effort:'low'},{...preset.targets[0],effort:'high'}]};
  const selection=initialSelection(sweep);
  assert.equal(selectionView(sweep,selection).calls,4);
  selection.effort='high';
  assert.equal(selectionView(sweep,selection).calls,2);
  assert.equal(selectionView(sweep,selection).targets.length,1);
});
test('an explicitly unavailable effort remains a valid designated setting when preparing a rerun',()=>{
  const unavailable={...preset,targets:[{model:'fixed',harness:'fixed-cli',effort:'unavailable',effort_levels:[]}]};
  const selection=initialSelection(unavailable);
  selection.effort='unavailable';
  assert.deepEqual(effortLevels(unavailable,selection),['unavailable']);
  assert.equal(runRequest(unavailable,selection).effort,'unavailable');
  selection.effort='high';
  assert.equal(runRequest(unavailable,selection),null);
});
