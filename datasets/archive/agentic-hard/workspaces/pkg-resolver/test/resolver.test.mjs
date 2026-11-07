import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, CycleError, NotFoundError, Registry, fromLockfile, renderTree, resolve, toLockfile } from '../src/index.mjs';

const registry = new Registry({
  app: { '1.0.0': {} },
  a: { '1.0.0': { b: '^1.0.0' }, '1.1.0': { b: '^1.0.0' } },
  b: { '1.0.0': {}, '1.1.0': { c: '^2.0.0' } },
  c: { '2.0.0': {} },
});

test('resolves transitive dependencies to the highest versions', () => {
  assert.deepEqual(resolve({ a: '^1.0.0' }, registry), { a: '1.1.0', b: '1.1.0', c: '2.0.0' });
});

test('an unknown package is not found', () => {
  assert.throws(() => resolve({ nope: '^1.0.0' }, registry), NotFoundError);
});

test('a range that no version matches is a conflict naming the package', () => {
  assert.throws(
    () => resolve({ a: '^5.0.0' }, registry),
    (error) => error instanceof ConflictError && error.pkg === 'a' && error.requirements.length === 1,
  );
});

test('a cycle is an error', () => {
  const loop = new Registry({ a: { '1.0.0': { b: '^1.0.0' } }, b: { '1.0.0': { a: '^1.0.0' } } });
  assert.throws(() => resolve({ a: '^1.0.0' }, loop), CycleError);
});

test('the error names the whole cycle, starting and ending at the same package', () => {
  const loop = new Registry({ a: { '1.0.0': { b: '^1.0.0' } }, b: { '1.0.0': { a: '^1.0.0' } } });
  assert.throws(
    () => resolve({ a: '^1.0.0' }, loop),
    (error) => error instanceof CycleError && error.path.join(',') === 'a,b,a',
  );
});

test('a shared dependency is not a cycle', () => {
  const diamond = new Registry({
    top: { '1.0.0': { left: '^1.0.0', right: '^1.0.0' } },
    left: { '1.0.0': { base: '^1.0.0' } },
    right: { '1.0.0': { base: '^1.0.0' } },
    base: { '1.0.0': {} },
  });
  assert.deepEqual(resolve({ top: '^1.0.0' }, diamond), { base: '1.0.0', left: '1.0.0', right: '1.0.0', top: '1.0.0' });
});

test('lockfile round trip and tree', () => {
  const result = resolve({ a: '^1.0.0' }, registry);
  const text = toLockfile(result, registry);
  assert.deepEqual(fromLockfile(text), result);
  assert.equal(renderTree({ a: '^1.0.0' }, result, registry), 'a@1.1.0\n  b@1.1.0\n    c@2.0.0');
});
