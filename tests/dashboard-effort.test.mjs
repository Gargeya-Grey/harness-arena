import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {planExperiment} from '../lab/commands/run.mjs';
import {buildArgs, catalog} from '../dashboard/jobs.mjs';
import {signalForQuery} from '../lab/lib/signal.mjs';

let root;
test.before(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'lab-effort-'));
  fs.cpSync(fileURLToPath(new URL('./fixtures/repo',import.meta.url)),root,{recursive:true});
  fs.mkdirSync(path.join(root,'experiments'),{recursive:true});
  fs.writeFileSync(path.join(root,'configs/models.yaml'),'models:\n  toy:\n    provider: openai\n    model: toy-snapshot\n    display_name: Toy model\n    effort_levels: [low, high]\n    params: {}\n');
  fs.writeFileSync(path.join(root,'experiments/effort.yaml'),'id: effort\nsuite: smoke\nprompt: qa-single-turn\nprompt_version: "1"\neffort_policy: explicit\ntargets:\n  - model: toy\n    harness: codex\n    effort: high\nrepeats: 1\nevaluators:\n  - id: exact-match\n    version: "1"\n');
});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

test('an explicit effort override changes the actual plan and its resumable snapshot without editing the preset',()=>{
  const file=path.join(root,'experiments/effort.yaml');
  const before=fs.readFileSync(file,'utf8');
  const plan=planExperiment(root,file,{effort:'low'});
  assert.deepEqual([...plan.groups.values()].map(group=>group.effort),['low']);
  assert.equal(plan.experiment.targets[0].effort,'low');
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.throws(()=>planExperiment(root,file,{effort:'max'}),/supported|verified/i);
  assert.throws(()=>planExperiment(root,file,{effort:'default'}),/explicit|effort/i);
});

test('Preview, Start and signal carry the same supported effort, and explicit empty selections cannot broaden a request',()=>{
  const body={command:'run',experiment:'effort.yaml',harness:'codex',models:['toy'],cases:['smoke-001'],repeats:1,effort:'low',dry_run:true};
  const args=buildArgs(root,body);
  assert.equal(args[args.indexOf('--effort')+1],'low');
  assert.throws(()=>buildArgs(root,{...body,effort:'max'}),/supported|verified/i);
  assert.throws(()=>buildArgs(root,{...body,models:[]}),/model/i);
  assert.throws(()=>buildArgs(root,{...body,cases:[]}),/case/i);
  const signal=signalForQuery(root,{experiment:'effort.yaml',models:'toy',cases:'smoke-001',effort:'low'});
  assert(signal.setups.every(setup=>setup.config_id.includes('__low')));
});

test('the catalog exposes the supported levels and model identity for the effort control',()=>{
  const target=catalog(root).experiments.find(item=>item.file==='effort.yaml').targets[0];
  assert.deepEqual(target.effort_levels,['low','high']);
  assert.equal(target.display_name,'Toy model');
});
test('a harness without effort control can explicitly retain unavailable even when its model supports effort elsewhere',()=>{
  const file=path.join(root,'experiments/no-control.yaml');
  fs.writeFileSync(file,fs.readFileSync(path.join(root,'experiments/effort.yaml'),'utf8').replace('harness: codex','harness: gemini-cli').replace('effort: high','effort: unavailable'));
  const plan=planExperiment(root,file,{effort:'unavailable'});
  assert.deepEqual([...plan.groups.values()].map(group=>group.effort),['unavailable']);
  assert.throws(()=>planExperiment(root,file,{effort:'high'}),/no effort control/i);
});

test('explicit setups can bring a second harness into the preset and repeat a model at another effort', () => {
  const other = path.join(root, 'experiments', 'other.yaml');
  fs.writeFileSync(other, fs.readFileSync(path.join(root, 'experiments', 'effort.yaml'), 'utf8').replace('harness: codex', 'harness: claude-code'));
  try {
    const targets = [
      { model: 'toy', harness: 'codex', effort: 'low' },
      { model: 'toy', harness: 'codex', effort: 'high' },
      { model: 'toy', harness: 'claude-code', effort: 'high' },
    ];
    const body = { command: 'run', experiment: 'effort.yaml', targets, cases: ['smoke-001'], repeats: 1 };
    const args = buildArgs(root, body);
    assert.deepEqual(JSON.parse(args[args.indexOf('--targets') + 1]), targets);
    const plan = planExperiment(root, path.join(root, 'experiments', body.experiment), body);
    assert.deepEqual([...plan.groups.keys()], ['codex@low', 'codex@high', 'claude-code@high']);
    assert.deepEqual(plan.experiment.targets, targets);
    const signal = signalForQuery(root, { experiment: body.experiment, targets: JSON.stringify(targets), cases: 'smoke-001' });
    assert.equal(signal.setups.length, 3);
    assert.throws(() => buildArgs(root, { ...body, targets: [] }), /at least one setup/);
    assert.throws(() => buildArgs(root, { ...body, targets: [targets[0], targets[0]] }), /listed twice/);
    assert.throws(() => buildArgs(root, { ...body, targets: [{ ...targets[0], effort: 'ultra' }] }), /verified supported level/);
    assert.throws(() => buildArgs(root, { ...body, targets: [{ ...targets[0], harness: 'command-code' }] }), /registered model and harness/);
  } finally {
    fs.rmSync(other);
  }
});
