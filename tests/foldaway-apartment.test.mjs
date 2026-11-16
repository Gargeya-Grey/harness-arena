import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrompt, loadSuite, loadYamlFile } from '../lab/lib/repo.mjs';
import { SchemaSet } from '../lab/lib/schema.mjs';
import { MODES, createState, poseAt, seek, retarget, togglePlayback, advance } from '../examples/foldaway-apartment/timeline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('apartment variants are valid, share a task family and keep difficulty estimates explicit', () => {
  const suite = loadSuite(ROOT, 'foldaway-apartment');
  const schemas = new SchemaSet(path.join(ROOT, 'schemas'));
  assert.equal(suite.cases.length, 3);
  assert.deepEqual(loadPrompt(ROOT, 'visual-web', '1').variables, ['task']);
  assert.deepEqual(suite.cases.map((item) => item.metadata.browser.variant), ['guided', 'scrubbable', 'reversible']);
  assert.deepEqual(suite.cases.map((item) => item.metadata.tier.human_minutes), [90, 180, 300]);
  for (const item of suite.cases) {
    assert.deepEqual(schemas.validate('case.schema.json', item), []);
    assert.match(item.metadata.tier.basis, /Untimed estimate/);
    assert.equal(item.metadata.browser.kind, 'foldaway-apartment');
    assert.equal(item.expected.check, 'delivery');
    assert.match(item.input.task, /window\.__apartment/);
    assert.match(item.input.task, /not disappear/i);
    const starter = path.join(suite.dir, 'workspaces', item.input.workspace);
    assert.deepEqual(fs.readdirSync(starter), ['README.md'], 'starter never contains the reference');
  }
  for (const name of ['foldaway-apartment-pilot', 'foldaway-apartment-codex-installed']) {
    const experiment = loadYamlFile(path.join(ROOT, 'experiments', `${name}.yaml`));
    assert.equal(experiment.suite, 'foldaway-apartment');
    assert.equal(experiment.prompt, 'visual-web');
    assert.deepEqual(experiment.cases, ['foldaway-apartment-reversible']);
    assert.equal(experiment.repeats, 1);
    assert.deepEqual(experiment.evaluators, [{ id: 'workspace-tests', version: '2', dimension: 'format' }]);
  }
});

test('one timeline has distinct studio, dining and bedroom states with furniture conserved', () => {
  const studio = poseAt(MODES.Studio);
  const dining = poseAt(MODES.Dining);
  const bedroom = poseAt(MODES.Bedroom);
  assert.equal(studio.bed.rotationX, -Math.PI / 2);
  assert.equal(dining.table.leafAngle, 0);
  assert.equal(studio.table.leafAngle, Math.PI / 2);
  assert.ok(Math.abs(bedroom.bed.rotationX) < 1e-9);
  assert.ok(bedroom.table.x > 1.8);
  assert.ok(bedroom['chair-left'].x > 2.1);
  const saved = new Map();
  for (const p of [0, 0.13, 0.5, 0.71, 1]) {
    assert.deepEqual(Object.keys(poseAt(p)), Object.keys(studio));
    for (const pose of Object.values(poseAt(p))) assert.ok(Object.values(pose).every(Number.isFinite));
    saved.set(p, poseAt(p));
  }
  for (const p of [...saved.keys()].reverse()) assert.deepEqual(poseAt(p), saved.get(p), 'revisiting a pose does not accumulate changes');
});

function dependencies(pose) {
  if (pose.bed.rotationX > -Math.PI / 2 + 0.001) {
    assert.ok(pose.table.x >= 1.8, 'the table clears before the bed unfolds');
    assert.ok(pose['chair-left'].x >= 2.1 && pose['chair-right'].x >= 2.1, 'both chairs park before the bed unfolds');
  }
}

test('staged dependencies hold in both directions and reject simultaneous unfold mutant', () => {
  for (let sample = 0; sample <= 500; sample++) dependencies(poseAt(sample / 500));
  for (let sample = 500; sample >= 0; sample--) dependencies(poseAt(sample / 500));
  const broken = poseAt(0.55);
  broken.bed.rotationX = -Math.PI / 4;
  assert.throws(() => dependencies(broken), /table clears/);
});

test('pause, scrub, interrupted retargeting and reset preserve the actual pose', () => {
  const state = createState();
  assert.deepEqual(state, { progress: 0, target: 0, playing: false });
  retarget(state, 1);
  for (let frame = 0; frame < 100; frame++) advance(state, 0.1);
  const position = state.progress;
  const pose = poseAt(position);
  retarget(state, 0);
  assert.equal(state.progress, position, 'retargeting does not teleport');
  assert.deepEqual(poseAt(state.progress), pose);
  advance(state, 0.1);
  assert.ok(state.progress < position);
  togglePlayback(state);
  const paused = state.progress;
  advance(state, 10);
  assert.equal(state.progress, paused);
  seek(state, 0.73);
  assert.deepEqual(state, { progress: 0.73, target: 0.73, playing: false });
  retarget(state, 1, true);
  assert.deepEqual(state, { progress: 1, target: 1, playing: false });
  seek(state, 0);
  assert.deepEqual(state, createState());
});

test('playback lands exactly, resumes toward its target and handles invalid numeric input', () => {
  const state = createState();
  togglePlayback(state);
  assert.equal(state.target, 0.5);
  for (let frame = 0; frame < 1000; frame++) advance(state, 0.1);
  assert.deepEqual(state, { progress: 0.5, target: 0.5, playing: false });
  togglePlayback(state);
  assert.equal(state.target, 1);
  advance(state, Number.NaN);
  assert.equal(state.progress, 0.5);
  seek(state, -1);
  assert.equal(state.progress, 0);
  seek(state, 3);
  assert.equal(state.progress, 1);
  seek(state, Number.NaN);
  assert.equal(state.progress, 0);
});

test('playback follows elapsed time when frames are irregular or throttled', () => {
  const state = createState();
  retarget(state,1);
  for (const seconds of [1,0.5,2.5,0.2,1.8,3,3]) advance(state,seconds);
  assert.deepEqual(state,{progress:1,target:1,playing:false});
  retarget(state,0);
  advance(state,12);
  assert.deepEqual(state,{progress:0,target:0,playing:false});
});
