import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareRerun } from '../dashboard/run-actions.mjs';

test('CLI effort reaches the harness, survives rerun preparation, and the delete/reset commands leave inputs intact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-effort-cli-'));
  const cli = fileURLToPath(new URL('../lab/cli.mjs', import.meta.url));
  fs.cpSync(fileURLToPath(new URL('./fixtures/repo', import.meta.url)), root, { recursive: true });
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  const fake = path.join(root, 'stand-in-harness.mjs');
  fs.writeFileSync(fake, 'if (process.argv.includes("--version")) { console.log("1.0.0"); } else { process.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify({text:process.argv.at(-1),input:1,output:1}))); }\n');
  fs.writeFileSync(path.join(root, 'configs/models.yaml'), 'models:\n  toy:\n    provider: openai\n    model: toy-snapshot\n    effort_levels: [low, high]\n    params: {}\n');
  fs.writeFileSync(path.join(root, 'configs/harnesses.yaml'), `harnesses:\n  test-effort:\n    bin: node\n    args: [${JSON.stringify(fake.replace(/\\/g, '/'))}]\n    version_args: [${JSON.stringify(fake.replace(/\\/g, '/'))}, --version]\n    stdin: true\n    effort_args: [--effort, "{effort}"]\n    output: json\n    result:\n      text: text\n      input_tokens: input\n      output_tokens: output\n`);
  const preset = path.join(root, 'experiments/effort.yaml');
  fs.writeFileSync(preset, 'id: effort\nsuite: smoke\nprompt: qa-single-turn\nprompt_version: "1"\neffort_policy: explicit\ntargets:\n  - model: toy\n    harness: test-effort\n    effort: high\ncases: [smoke-001]\nrepeats: 1\nevaluators:\n  - id: exact-match\n    version: "1"\n');
  const env = { ...process.env, LAB_ROOT: root, LAB_DATA: path.join(root, '.lab-data') };
  delete env.NODE_TEST_CONTEXT;
  const invoke = args => execFileSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  try {
    invoke(['run', preset, '--effort', 'low']);
    const results = path.join(root, '.lab-data/results');
    const id = fs.readdirSync(results).find(name => !name.startsWith('.'));
    const manifest = JSON.parse(fs.readFileSync(path.join(results, id, 'run.json')));
    const row = JSON.parse(fs.readFileSync(path.join(results, id, 'raw.jsonl'), 'utf8').trim());
    assert.equal(manifest.status, 'completed');
    assert.equal(manifest.models[0].reasoning_effort, 'low');
    assert.equal(manifest.experiment.targets[0].effort, 'low');
    assert.equal(row.response.text, 'low', 'the harness receives the chosen effort argument');
    const previous = { LAB_DATA: process.env.LAB_DATA, LAB_TEST_DATA: process.env.LAB_TEST_DATA };
    try {
      process.env.LAB_DATA = env.LAB_DATA;
      process.env.LAB_TEST_DATA = env.LAB_DATA;
      assert.equal(prepareRerun(root, id).selection.effort, 'low');
    } finally { for (const [name, value] of Object.entries(previous)) value === undefined ? delete process.env[name] : process.env[name] = value; }
    assert.equal(fs.readFileSync(preset, 'utf8').includes('effort: high'), true, 'the preset stays unchanged');
    invoke(['delete', id, '--confirm', id]);
    assert.equal(fs.existsSync(path.join(results, id)), false);
    invoke(['reset', '--confirm', 'DELETE ALL RUNS']);
    assert.equal(fs.readFileSync(path.join(root, 'lab.ledger.jsonl'), 'utf8'), '');
    assert(fs.existsSync(preset));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
