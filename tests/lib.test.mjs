// Core libraries: the YAML subset, the JSON Schema subset, metrics and cost.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../lab/lib/yaml.mjs';
import { SchemaSet } from '../lab/lib/schema.mjs';
import { bootstrapMean, costUsd, mean, percentile, wilson } from '../lab/lib/metrics.mjs';
import { REPO_ROOT, renderMessages, resolveExperiment } from '../lab/lib/repo.mjs';

test('yaml: maps, lists, flow values, quoting and block scalars', () => {
  const doc = parseYaml(
    [
      'id: smoke # comment',
      'version: "1"',
      'repeats: 3',
      'flag: true',
      'empty: null',
      'tags: [a, "b c", 3]',
      'inline: {x: 1, y: two}',
      'targets:',
      '- model: m1',
      '  harness: codex',
      '- model: m2',
      'text: |',
      '  line one',
      '  line two',
      'folded: >-',
      '  a',
      '  b',
    ].join('\n'),
  );
  assert.deepEqual(doc, {
    id: 'smoke',
    version: '1',
    repeats: 3,
    flag: true,
    empty: null,
    tags: ['a', 'b c', 3],
    inline: { x: 1, y: 'two' },
    targets: [{ model: 'm1', harness: 'codex' }, { model: 'm2' }],
    text: 'line one\nline two\n',
    folded: 'a b',
  });
});

test('yaml: refuses what the subset does not support, with a line number', () => {
  assert.throws(() => parseYaml('a: 1\na: 2', 'dup.yaml'), /dup\.yaml:2.*duplicate/i);
  assert.throws(() => parseYaml('a: &x 1\nb: *x'), /anchor|alias/i);
  assert.throws(() => parseYaml('a:\n\tb: 1'), /tab/i);
  assert.throws(() => parseYaml('a: 1\n---\nb: 2'), /document/i);
});

test('yaml: every YAML file in the repository parses', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.cache', 'tests'].includes(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.yaml')) files.push(abs);
    }
  };
  walk(REPO_ROOT);
  assert.ok(files.length >= 5, `found ${files.length} YAML files`);
  for (const file of files) assert.doesNotThrow(() => parseYaml(fs.readFileSync(file, 'utf8'), file), file);
});

test('schema: accepts a valid case and reports each fault in a bad one', () => {
  const schemas = new SchemaSet(path.join(REPO_ROOT, 'schemas'));
  assert.deepEqual(schemas.validate('case.schema.json', { case_id: 'smoke-001', input: { question: 'q' }, expected: '4', tags: [] }), []);
  const errors = schemas.validate('case.schema.json', { case_id: 'Bad Id', input: 'nope' });
  assert.ok(errors.some((line) => /case_id/.test(line)), errors.join('\n'));
  assert.ok(errors.some((line) => /input/.test(line)), errors.join('\n'));
});

test('metrics: mean, nearest-rank percentile, Wilson interval', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(mean([]), null);
  assert.equal(percentile([10, 20, 30, 40, 50], 0.5), 30);
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 50);
  const [low, high] = wilson(8, 10);
  assert.ok(low > 0.44 && low < 0.5 && high > 0.94 && high < 0.98, `${low} ${high}`);
  assert.equal(wilson(0, 0), null);
});

test('metrics: bootstrap needs n >= 3 and is deterministic for a seed', () => {
  assert.equal(bootstrapMean([1, 0]), null);
  const a = bootstrapMean([1, 0, 1, 1, 0, 1], 'seed');
  const b = bootstrapMean([1, 0, 1, 1, 0, 1], 'seed');
  assert.deepEqual(a, b);
  assert.ok(a[0] <= 4 / 6 && a[1] >= 4 / 6);
});

test('cost: reproduces the first stored run (cache reads at their own rate)', () => {
  const usage = { input_tokens: 19010, output_tokens: 3, cache_read_tokens: 5504, cache_write_tokens: 0 };
  const pricing = { input_per_1m: 0.15, output_per_1m: 0.6, cache_read_per_1m: 0.003 };
  assert.equal(Number(costUsd(usage, pricing).toFixed(9)), 0.002044212);
});

test('cost: cache rates default to the input rate; missing usage gives null', () => {
  const usage = { input_tokens: 1000, output_tokens: 0, cache_read_tokens: 400, cache_write_tokens: 100 };
  assert.equal(costUsd(usage, { input_per_1m: 1, output_per_1m: 5 }), 0.001);
  assert.equal(costUsd({ input_tokens: null, output_tokens: null }, { input_per_1m: 1, output_per_1m: 5 }), null);
});

test('repo: a missing template variable is an error, never blank', () => {
  assert.deepEqual(renderMessages([{ role: 'user', content: 'Q: {{ question }}' }], { question: '2+2' }), [{ role: 'user', content: 'Q: 2+2' }]);
  assert.throws(() => renderMessages([{ role: 'user', content: '{{missing}}' }], {}), /missing/);
});

test('repo: experiments resolve targets, shorthand models and their problems', () => {
  const registry = { a: {}, b: {} };
  const full = resolveExperiment({ id: 'x', suite: 's', prompt: 'p', targets: [{ model: 'a', harness: 'codex' }] }, registry);
  assert.deepEqual(full.problems, []);
  const shorthand = resolveExperiment({ id: 'x', suite: 's', prompt: 'p', harness: 'codex', models: ['a', 'b'] }, registry);
  assert.deepEqual(shorthand.targets.map((t) => `${t.model}/${t.harness}`), ['a/codex', 'b/codex']);
  const bad = resolveExperiment({ targets: [{ model: 'zzz' }] }, registry);
  assert.ok(bad.problems.some((p) => /zzz.*not in configs/.test(p)));
  assert.ok(bad.problems.some((p) => /no harness/.test(p)));
  assert.ok(bad.problems.some((p) => /no "id"/.test(p)));
});

test('redact: setup keys are dropped and the home folder becomes ~, in any slash style', async () => {
  const { redactEvent, redactPaths, REDACTED } = await import('../lab/lib/redact.mjs');
  const home = String.raw`C:\Users\Someone`;
  assert.equal(redactPaths('at file:///C:/Users/Someone/AppData/x.js', home), 'at file:///~/AppData/x.js');
  assert.equal(redactPaths(String.raw`cwd c:\users\someone\Temp`, home), String.raw`cwd ~\Temp`);
  assert.equal(redactPaths(String.raw`C:\Users\SomeoneElse\x`, home), String.raw`C:\Users\SomeoneElse\x`, 'another user folder is not this home');
  assert.equal(redactPaths(String.raw`C:\Users\Someone`, home), '~');
  const event = {
    type: 'system',
    cwd: String.raw`C:\Users\Someone\AppData\Local\Temp\model-lab\run`,
    mcp_servers: ['claude.ai Gmail'],
    memory_paths: { auto: String.raw`C:\Users\Someone\.claude\memory\ ` },
    result: { nextState: { modState: { workspace: { gitStatus: '?? .private-folder/\n', branch: null } } } },
    tools: ['Bash', 'mcp__claude_ai_Gmail__send'],
    usage: { input_tokens: 5 },
  };
  const out = redactEvent(event, home);
  const text = JSON.stringify(out);
  assert.ok(!text.includes('Someone'), text);
  assert.ok(!text.includes('private-folder') && !text.includes('Gmail'), text);
  assert.equal(out.mcp_servers, REDACTED);
  assert.equal(out.result.nextState.modState.workspace.gitStatus, REDACTED);
  assert.equal(out.cwd, String.raw`~\AppData\Local\Temp\model-lab\run`);
  assert.deepEqual(out.usage, { input_tokens: 5 });
  assert.equal(event.mcp_servers[0], 'claude.ai Gmail', 'the input is not changed');
});

test('redact: every form a harness prints the home folder in, and nothing else', async () => {
  const { redactEvent, redactPaths, REDACTED } = await import('../lab/lib/redact.mjs');
  const home = String.raw`C:\Users\Ann`;
  for (const [text, want] of [
    ['/c/Users/Ann/AppData/x', '~/AppData/x'],
    ['cd /mnt/c/Users/Ann/x', 'cd ~/x'],
    ['file:///C%3A/Users/Ann/x.js', 'file:///~/x.js'],
    ['C%3A%5CUsers%5CAnn%5Cx', '~%5Cx'],
    [String.raw`\\localhost\c$\Users\Ann\x`, String.raw`~\x`],
    [JSON.stringify(String.raw`C:\Users\Ann\x`), JSON.stringify(String.raw`~\x`)],
    [String.raw`xC:\Users\Ann`, String.raw`xC:\Users\Ann`],
    ['/c/Users/Anna/x', '/c/Users/Anna/x'],
  ]) assert.equal(redactPaths(text, home), want, text);
  assert.equal(redactPaths('the root cause, cd /root/x', '/root'), 'the root cause, cd ~/x');
  assert.equal(redactPaths(String.raw`C:\Windows`, 'C:\\'), String.raw`C:\Windows`, 'a home at the drive root redacts nothing');

  const gemini = { response: '4', stats: { tools: { totalCalls: 2, byName: { ls: 1 } } } };
  assert.deepEqual(redactEvent(gemini, home), gemini, 'nested tools stats are evidence');
  const call = { type: 'tool_use', input: { commands: ['ls'], tools: ['x'] } };
  assert.deepEqual(redactEvent(call, home), call, 'a tool call input is evidence');
  const init = { type: 'system', tools: ['Bash'], workspace: { branch: 'private-branch', cwd: 'x' }, [String.raw`C:\Users\Ann\k`]: 1 };
  assert.deepEqual(redactEvent(init, home), { type: 'system', tools: REDACTED, workspace: { branch: REDACTED, cwd: 'x' }, [String.raw`~\k`]: 1 });
});
