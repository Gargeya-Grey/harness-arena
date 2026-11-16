import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../src/index.mjs';
import { T, S, runner } from './helpers.mjs';

test('one slot runs a chain in dependency order', () => {
  const { run } = runner();
  const result = build({ a: T([], 10), b: T(['a'], 5), c: T(['b'], 1) }, { run });
  assert.deepEqual(result.startOrder, ['a', 'b', 'c']);
  assert.equal(result.makespan, 16);
  assert.equal(result.ok, true);
});

test('two slots run independent targets side by side', () => {
  const { run } = runner();
  const result = build({ x: T([], 10), y: T([], 10), z: T(['x', 'y'], 2) }, { run, slots: 2 });
  assert.equal(result.targets.x.slot, 0);
  assert.equal(result.targets.y.slot, 1);
  assert.equal(result.targets.z.start, 10);
  assert.equal(result.makespan, 12);
});

test('a built target takes the source text as its input', () => {
  const { run } = runner();
  const result = build({ src: S('hello'), up: T(['src'], 1) }, { run });
  assert.equal(result.targets.src.status, 'source');
  assert.equal(result.cache.up.output, 'up(hello)');
});

test('the second build with the same cache runs nothing', () => {
  const graph = { a: T([], 3), b: T(['a'], 3) };
  const first = build(graph, { run: runner().run });
  const again = runner();
  const second = build(graph, { run: again.run, cache: first.cache });
  assert.deepEqual(again.calls, []);
  assert.equal(second.targets.b.status, 'cached');
  assert.equal(second.makespan, 0);
});

test('a failed target skips its dependents and the rest goes on', () => {
  const { run } = runner(['b']);
  const result = build({ a: T(), b: T(['a']), c: T(['b']), d: T(['a']) }, { run });
  assert.equal(result.targets.b.status, 'failed');
  assert.equal(result.targets.c.status, 'skipped');
  assert.equal(result.targets.c.cause, 'b');
  assert.equal(result.targets.d.status, 'built');
  assert.equal(result.ok, false);
});

test('an unknown dependency is a GraphError', () => {
  assert.throws(() => build({ a: T(['nope']) }, { run: runner().run }), (error) => error.name === 'GraphError' && error.dep === 'nope');
});
