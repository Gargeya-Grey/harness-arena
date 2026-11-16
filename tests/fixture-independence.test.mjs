import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildState } from '../lab/lib/state.mjs';
import { validateRepo } from '../lab/commands/validate.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
test('fixture generation works in a checkout with no live runs or previous generated fixture', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-fixture-independent-'));
  try {
    for (const dir of ['lab', 'schemas', 'datasets/smoke', 'prompts/qa-single-turn', 'prompts/reasoning-final-answer']) fs.cpSync(path.join(repo, dir), path.join(root, dir), { recursive: true });
    fs.mkdirSync(path.join(root, 'configs'), { recursive: true });
    fs.copyFileSync(path.join(repo, 'configs/ladder.yaml'), path.join(root, 'configs/ladder.yaml'));
    fs.mkdirSync(path.join(root, 'tests/fixtures'), { recursive: true });
    fs.copyFileSync(path.join(repo, 'tests/fixtures/make-fixtures.mjs'), path.join(root, 'tests/fixtures/make-fixtures.mjs'));
    execFileSync(process.execPath, [path.join(root, 'tests/fixtures/make-fixtures.mjs')], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(fs.existsSync(path.join(root, 'results')), false, 'generation never creates live run history');
    const generated = path.join(root, 'tests/fixtures/repo');
    assert.deepEqual(validateRepo(generated).problems, []);
    const state = buildState(generated, { validate: false });
    assert.equal(state.runs.length, 14);
    assert.equal(state.observations.length, 123);
    assert(state.runs.every(run => /Synthetic/.test(JSON.parse(fs.readFileSync(path.join(generated, 'results', run.run_id, 'run.json'))).notes)), 'every generated run is labelled synthetic');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
