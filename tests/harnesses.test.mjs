// Declared harnesses (configs/harnesses.yaml) and the Windows shim lookup, with
// real child processes: a small Node script plays the part of an unknown CLI.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDeclared } from '../lab/adapters/declared.mjs';
import { getAdapter, loadAdapters, readDeclared } from '../lab/adapters/index.mjs';
import { resolveCommand } from '../lab/adapters/process.mjs';

const builtIn = new Set(['claude-code', 'opencode']);

test('checkDeclared: refuses entries that would run wrongly', () => {
  assert.deepEqual(checkDeclared('ok-cli', { bin: 'x', args: ['{prompt}'] }, builtIn), []);
  assert.match(checkDeclared('opencode', { bin: 'x', args: ['{prompt}'] }, builtIn).join(), /built-in/);
  assert.match(checkDeclared('a', { bin: 'x', args: ['--model'] }, builtIn).join(), /pass the prompt/);
  assert.match(checkDeclared('a', { bin: 'x', args: ['--p={prompt}'] }, builtIn).join(), /whole argument/);
  assert.match(checkDeclared('a', { bin: 'x', args: ['{prompt}'], stdin: true }, builtIn).join(), /not both/);
  assert.match(checkDeclared('a', { bin: 'x', args: ['{prompt}'], output: 'jsonl' }, builtIn).join(), /result\.text/);
  assert.match(checkDeclared('a', { bin: 'x', args: ['{prompt}'], output: 'xml' }, builtIn).join(), /output must be/);
});

function rootWith(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-declared-'));
  fs.mkdirSync(path.join(root, 'configs'));
  fs.writeFileSync(path.join(root, 'configs', 'harnesses.yaml'), `${lines.join('\n')}\n`);
  return root;
}

const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-fake-cli-'));
const script = path.join(scriptDir, 'fake-cli.mjs').replace(/\\/g, '/');
fs.writeFileSync(
  script,
  [
    "if (process.argv.includes('--version')) { console.log('fake-cli 1.2.3'); process.exit(0); }",
    "if (process.argv.includes('--echo-args')) { process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exit(0); }",
    'const [model, prompt] = process.argv.slice(2);',
    "console.log('banner line');",
    "console.log(JSON.stringify({ type: 'step', text: 'thinking' }));",
    "console.log(JSON.stringify({ type: 'result', answer: model + ':' + prompt, usage: { in: 12, out: 3 }, sid: 's-1' }));",
    "if (prompt === 'fail') process.exit(2);",
  ].join('\n'),
);
test.after(() => fs.rmSync(scriptDir, { recursive: true, force: true }));

const user = (content) => [{ role: 'user', content }];

test('a declared jsonl harness runs a real process and fills the record', async (t) => {
  const root = rootWith([
    'harnesses:',
    '  fake-cli:',
    '    bin: node',
    `    version_args: ["${script}", --version]`,
    `    args: ["${script}", "{model}", "{prompt}"]`,
    '    isolation_args: [--no-user]',
    '    output: jsonl',
    '    result:',
    '      where: { type: result }',
    '      text: answer',
    '      input_tokens: usage.in',
    '      output_tokens: usage.out',
    '      session_id: sid',
  ]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(readDeclared(root).problems, []);
  const adapter = getAdapter('fake-cli', root);
  assert.equal(adapter.declared, true);
  assert.deepEqual(adapter.isolation.args, ['--no-user']);
  assert.equal((await adapter.detect()).version, '1.2.3');
  const out = await adapter.call({ model: 'm1', messages: user('say "hi"\nnow'), cwd: root, timeoutMs: 30000 });
  assert.equal(out.error, null);
  assert.equal(out.text, 'm1:say "hi"\nnow', 'the prompt arrives byte for byte, with no shell');
  assert.deepEqual(out.usage, { input_tokens: 12, output_tokens: 3, cache_read_tokens: null, cache_write_tokens: null });
  assert.equal(out.session_id, 's-1');
});

test('a declared text harness reads stdout; a non-zero exit is an error', async (t) => {
  const root = rootWith(['harnesses:', '  text-cli:', '    bin: node', `    version_args: ["${script}", --version]`, `    args: ["${script}", plain, "{prompt}"]`]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const adapter = getAdapter('text-cli', root);
  const ok = await adapter.call({ model: 'm', messages: user('pong'), cwd: root, timeoutMs: 30000 });
  assert.equal(ok.error, null);
  assert.match(ok.text, /^banner line\n/);
  const bad = await adapter.call({ model: 'm', messages: user('fail'), cwd: root, timeoutMs: 30000 });
  assert.equal(bad.text, null);
  assert.equal(bad.error.type, 'no_result');
});

test('isolation flags reach the process only when the call is isolated', async (t) => {
  const root = rootWith([
    'harnesses:',
    '  argv-cli:',
    '    bin: node',
    `    version_args: ["${script}", --version]`,
    `    args: ["${script}", "{model}", "{prompt}"]`,
    '    effort_args: [--effort, "{effort}"]',
    '    isolation_args: [--echo-args, --no-user]',
  ]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const adapter = getAdapter('argv-cli', root);
  const isolated = await adapter.call({ model: 'm', effort: 'low', messages: user('q'), cwd: root, timeoutMs: 30000, isolated: true });
  assert.deepEqual(JSON.parse(isolated.text), ['m', 'q', '--effort', 'low', '--echo-args', '--no-user']);
  const loaded = await adapter.call({ model: 'm', messages: user('q'), cwd: root, timeoutMs: 30000 });
  assert.doesNotMatch(loaded.text, /--no-user/);
});

test('an invalid declared harness is reported and never loaded', (t) => {
  const root = rootWith(['harnesses:', '  broken:', '    bin: x', '    args: [--model]']);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(readDeclared(root).problems.length, 1);
  assert.equal(loadAdapters(root).broken, undefined);
  assert.throws(() => getAdapter('broken', root), /Unknown harness "broken"/);
});

test('malformed entries give problems, never a crash, and built-in harnesses still load', (t) => {
  const cases = [
    ['  numbers:', '    bin: x', '    args: [--retries, 3, "{prompt}"]'],
    ['  plain-string:', '    bin: x', '    args: "run {prompt}"'],
    ['  effort-prompt:', '    bin: x', '    args: ["{prompt}"]', '    effort_args: ["{prompt}"]'],
  ];
  for (const lines of cases) {
    const root = rootWith(['harnesses:', ...lines]);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.equal(readDeclared(root).problems.length, 1, lines[0]);
    assert.ok(loadAdapters(root)['claude-code']);
  }
  const broken = rootWith(['harnesses: [a, b]']);
  t.after(() => fs.rmSync(broken, { recursive: true, force: true }));
  assert.match(readDeclared(broken).problems[0], /must be a map/);
  const badYaml = rootWith(['harnesses:', '  x: &anchor {}']);
  t.after(() => fs.rmSync(badYaml, { recursive: true, force: true }));
  assert.ok(loadAdapters(badYaml).opencode, 'a YAML error never stops built-in harnesses');
});

test('resolveCommand: an npm shim resolves to its script or its native binary, never to node.exe', { skip: process.platform !== 'win32' }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-shims-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nodeGuard = '@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n';
  fs.writeFileSync(path.join(dir, 'labjs-x1.cmd'), `${nodeGuard}"%_prog%"  "%dp0%\\node_modules\\pkg\\cli.mjs" %*\r\n`);
  fs.writeFileSync(path.join(dir, 'labexe-x1.cmd'), `${nodeGuard}"%dp0%\\node_modules\\@x\\cli\\bin\\tool.exe"   %*\r\n`);
  const saved = process.env.PATH;
  process.env.PATH = dir;
  t.after(() => (process.env.PATH = saved));
  assert.deepEqual(resolveCommand('labjs-x1'), { command: process.execPath, prefix: [path.join(dir, 'node_modules\\pkg\\cli.mjs')] });
  assert.deepEqual(resolveCommand('labexe-x1'), { command: path.join(dir, 'node_modules\\@x\\cli\\bin\\tool.exe'), prefix: [] });
});
