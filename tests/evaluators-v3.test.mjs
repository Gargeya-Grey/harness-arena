import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEvaluator } from '../lab/evaluators/index.mjs';
import * as evaluators from '../lab/evaluators/index.mjs';
import { snapshotWorkspace } from '../lab/lib/workspace.mjs';

const score = (version, text, expected) => getEvaluator('final-answer', version).score({ raw: { response: { text } }, testCase: { expected } });

test('historical final-answer@1 keeps its original tolerant interpretation', () => {
  assert.equal(score('1', 'Answer: 19933.01', 19933).passed, true);
  assert.equal(score('1', 'Answer: 180+1', 180).passed, true);
});

test('final-answer@2 requires one exact numeric scalar instead of an expression or tolerance', () => {
  assert(getEvaluator('final-answer', '2'));
  for (const [text, expected] of [['Answer: 19933.01', 19933], ['Answer: 180+1', 180], ['Answer: 180 km', 180], ['Answer: 25,00', 2500], ['Answer: 180 or 181', 180], ['Answer: NaN', 0]]) assert.equal(score('2', text, expected).passed, false, text);
  for (const [text, expected] of [['Answer: 19933', 19933], ['Answer: 133.20', 133.2], ['Answer: 2,500', 2500], ['Answer: -0.00', 0], ['Answer: .5', 0.5], ['Answer: 1e3', 1000], ['Answer: Friday.', 'Friday']]) assert.equal(score('2', text, expected).passed, true, text);
});

test('exact scalar comparison accepts a trailing decimal point without accepting repeated punctuation', () => {
  assert.equal(score('2', 'Answer: 59.', 59).passed, true);
  assert.equal(score('2', 'Answer: 59..', 59).passed, false);
});

test('js-function@3 accepts a near-CPU-limit call after allowed wall-only waiting', { timeout: 40000 }, () => {
  assert.equal(typeof evaluators.runJsTestsV3, 'function');
  const source = `const cpu = globalThis.constructor.constructor('return process')().cpuUsage.bind(globalThis.constructor.constructor('return process')());
function f() { const start = cpu(); let used = 0; while (used < 1900) { let n=0; for(let i=0;i<20000;i++) n+=Math.sqrt(i); const now=cpu(); used=(now.user+now.system-start.user-start.system)/1000; } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,350); return 7; }`;
  const run = evaluators.runJsTestsV3({ sources: [source], name: 'f', tests: [{ args: [], returns: 7 }], limits: { testCpuMs: 2000, caseCpuMs: 10000, cap: 10 } });
  assert.equal(run.results[0].ok, true, JSON.stringify(run));
});

test('js-function@3 separates a wall backstop from proven CPU budget noncompliance', { timeout: 15000 }, () => {
  const wait = evaluators.runJsTestsV3({ sources: ['function f(){ Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000); return 1; }'], name: 'f', tests: [{ args: [], returns: 1 }], limits: { testCpuMs: 40, caseCpuMs: 1000, cap: 3 } });
  assert.equal(wait.results[0].outcome, 'wall-backstop');
  const loop = evaluators.runJsTestsV3({ sources: ['function f(){ while(true){} }'], name: 'f', tests: [{ args: [], returns: 1 }], limits: { testCpuMs: 100, caseCpuMs: 1000, cap: 3 } });
  assert.equal(loop.results[0].outcome, 'cpu-limit');
  const evaluator = getEvaluator('js-function', '3');
  const slowWait = evaluator.score({ raw: { response: { text: 'function f(){ Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000); }' } }, testCase: { input: { name: 'f' }, expected: { tests: [{ args: [], returns: 1 }], limits: { testCpuMs: 100, caseCpuMs: 1000, cap: 3 } } } });
  assert.match(slowWait.skip, /wall-clock backstop/);
});

test('js-function@3 retries a stopped attempt inside the former 95 to 100 percent CPU gap', { timeout: 15000 }, () => {
  const source = `const proc = globalThis.constructor.constructor('return process')();
function f() {
  if (proc.__retryWindowCall) return proc.__retryWindowReached ? 7 : 8;
  proc.__retryWindowCall = true;
  const start = proc.cpuUsage(); let used = 0;
  while (used < 1950) { let n = 0; for (let i = 0; i < 20000; i++) n += Math.sqrt(i); const now = proc.cpuUsage(); used = (now.user + now.system - start.user - start.system) / 1000; }
  proc.__retryWindowReached = true;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
  return 7;
}`;
  const args = { sources: [source], name: 'f', tests: [{ args: [], returns: 7 }], limits: { testCpuMs: 2000, caseCpuMs: 10000, cap: 3 } };
  const repaired = evaluators.runJsTestsV3(args);
  assert.equal(repaired.results[0].ok, true, JSON.stringify(repaired));
});

function workspaceFixture(t, { probe, files = {}, tests, extraProbes = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-v3-workspace-'));
  const fixture = path.join(root, 'fixtures', 'one');
  const work = path.join(root, 'work');
  const runDir = path.join(root, 'run');
  const checkDir = path.join(root, 'checks', 'one');
  for (const directory of [fixture, work, runDir, checkDir]) fs.mkdirSync(directory, { recursive: true });
  for (const [name, content] of Object.entries({ 'README.md': 'Verification fixture.\n', ...files })) {
    for (const directory of [fixture, work]) {
      const target = path.join(directory, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  fs.writeFileSync(path.join(checkDir, 'probe.mjs'), `export const probes=[{name:'one',run(){${probe}}}${extraProbes.map(item => `,{name:${JSON.stringify(item.name)},run(){${item.body}}}`).join('')}];`);
  fs.writeFileSync(path.join(checkDir, 'expected.json'), JSON.stringify({ probes: { one: 1, ...Object.fromEntries(extraProbes.map(item => [item.name, 1])) }, ...(tests ? { tests } : {}) }));
  const artifact = snapshotWorkspace({ fixtureDir: fixture, workDir: work, runDir, base: 'w', artifactId: 'one', createdAt: '2026-11-16T00:00:00Z' });
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    const bytes = directory => fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? bytes(path.join(directory, entry.name)) : fs.statSync(path.join(directory, entry.name)).size), 0);
    const freed = bytes(root);
    fs.rmSync(root, { recursive: true, force: true });
    t.diagnostic(`Removed owned completed fixture; file-content bytes freed: ${freed}`);
  });
  return { raw: { response: { text: 'Done.' }, artifacts: [artifact] }, testCase: { input: { workspace: 'one' }, expected: { check: 'one', limits: { probeMs: 40, checkCpuMs: 1000, cap: 3 } } }, suite: { dir: root, workspacesDir: path.dirname(fixture), checksDir: path.dirname(checkDir) }, runDir };
}

test('workspace-tests@3 leaves an actual probe backstop unjudged, without trusting a forged timeout message', t => {
  const pending = workspaceFixture(t, { probe: 'return new Promise(()=>{});' });
  const outcome = getEvaluator('workspace-tests', '3').score(pending);
  assert.match(outcome.skip, /operational backstop/, JSON.stringify(outcome));
  const fake = workspaceFixture(t, { probe: "throw new Error('timed out after 1 s');" });
  const judged = getEvaluator('workspace-tests', '3').score(fake);
  assert.equal(judged.skip, undefined);
  assert.equal(judged.passed, false);
  assert.equal(judged.details.results[0].outcome, 'runtime-error');
});

test('workspace-tests@3 executes declared regression tests and rejects an empty registered test', t => {
  const rule = { files: ['test/discount.test.mjs'], minimum_tests: 1, required_calls: [{ module: 'src/cart.mjs', export: 'Cart', method: 'applyDiscount', instance: true, test_file: 'test/discount.test.mjs' }] };
  const files = { 'src/cart.mjs': 'export class Cart { applyDiscount(n){return n;} }', 'test/discount.test.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import {Cart} from '../src/cart.mjs'; test('discount',()=>assert.equal(new Cart().applyDiscount(5),5));" };
  const good = workspaceFixture(t, { probe: 'return 1;', files, tests: rule });
  const reference = getEvaluator('workspace-tests', '3').score(good);
  assert.equal(reference.passed, true, JSON.stringify(reference));
  const empty = workspaceFixture(t, { probe: 'return 1;', files: { ...files, 'test/discount.test.mjs': "import test from 'node:test'; test('empty',()=>{});" }, tests: rule });
  const wrong = getEvaluator('workspace-tests', '3').score(empty);
  assert.equal(wrong.passed, false, JSON.stringify(wrong));
  assert.equal(wrong.details.results.find(value => value.name === 'executable tests').ok, false);
  assert.equal(getEvaluator('workspace-tests', '2').score(empty).passed, true, 'the historical evaluator does not acquire the new test-execution rule');
});

test('a wall stop does not hide a definite wrong function return', () => {
  const result = getEvaluator('js-function', '3').score({ raw: { response: { text: 'function f(n){if(n===0)return 0; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);}' } }, testCase: { input: { name: 'f' }, expected: { tests: [{ args: [0], returns: 1 }, { args: [1], returns: 1 }], limits: { testCpuMs: 100, caseCpuMs: 1000, cap: 3 } } } });
  assert.equal(result.skip, undefined, JSON.stringify(result));
  assert.equal(result.passed, false);
  assert.equal(result.value, 0);
  assert.equal(result.details.results[1].unjudged, true);
});

for (const [name, body] of [['CPU spin', 'while(true){}'], ['unsettled promise', 'return new Promise(()=>{});']]) test(`a workspace ${name} does not hide a definite wrong probe`, t => {
  const fixture = workspaceFixture(t, { probe: 'return 0;', extraProbes: [{ name: 'unfinished', body }] });
  fixture.testCase.expected.limits.wallMs = 500;
  const result = getEvaluator('workspace-tests', '3').score(fixture);
  assert.equal(result.skip, undefined, JSON.stringify(result));
  assert.equal(result.passed, false);
  assert.equal(result.value, 0);
  assert.equal(result.details.results.find(item => item.name === 'unfinished').unjudged, true);
});

test('an executable-test backstop does not hide a definite wrong workspace probe', { timeout: 25000 }, t => {
  const rule = { files: ['test/discount.test.mjs'], minimum_tests: 1, required_calls: [{ module: 'src/cart.mjs', export: 'Cart', method: 'applyDiscount', instance: true, test_file: 'test/discount.test.mjs' }] };
  const fixture = workspaceFixture(t, { probe: 'return 0;', tests: rule, files: { 'src/cart.mjs': 'export class Cart { applyDiscount(n){return n;} }', 'test/discount.test.mjs': 'while(true){}' } });
  const result = getEvaluator('workspace-tests', '3').score(fixture);
  assert.equal(result.skip, undefined, JSON.stringify(result));
  assert.equal(result.passed, false);
  assert.equal(result.value, 0);
  assert.equal(result.details.results.find(item => item.name === 'executable tests').unjudged, true);
});

test('a later executable-test backstop preserves an already failed assertion', { timeout: 25000 }, t => {
  const rule = { files: ['test/discount.test.mjs'], minimum_tests: 1, required_calls: [{ module: 'src/cart.mjs', export: 'Cart', method: 'applyDiscount', instance: true, test_file: 'test/discount.test.mjs' }] };
  const fixture = workspaceFixture(t, { probe: 'return 1;', tests: rule, files: { 'src/cart.mjs': 'export class Cart { applyDiscount(n){return n;} }', 'test/discount.test.mjs': "import test from 'node:test';import assert from 'node:assert/strict';import {Cart} from '../src/cart.mjs';test('wrong discount',()=>assert.equal(new Cart().applyDiscount(1),2));test('unfinished',()=>new Promise(()=>setInterval(()=>{},1000)));" } });
  const result = getEvaluator('workspace-tests', '3').score(fixture);
  assert.equal(result.skip, undefined, JSON.stringify(result));
  assert.equal(result.passed, false);
  const execution = result.details.results.find(item => item.name === 'executable tests');
  assert.equal(execution.unjudged, true);
  assert.equal(execution.definite_failure, true);
});

test('per-test retries after heap death preserve a later wall-stop classification', { timeout: 20000 }, () => {
  const run = evaluators.runJsTestsV3({ sources: ['function f(n){if(n===0){const keep=[];while(true)keep.push(new Array(1e6).fill(1));}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);}'], name: 'f', tests: [{ args: [0], returns: 1 }, { args: [1], returns: 1 }], limits: { testCpuMs: 5000, caseCpuMs: 20000, cap: 3, wallMs: 1500 } });
  assert.equal(run.results[1].outcome, 'wall-backstop', JSON.stringify(run));
});
