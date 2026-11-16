import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCheck, runWorkspaceCheckV2 } from '../lab/evaluators/index.mjs';
import { runExecutableTests } from '../lab/evaluators/workspace-test-execution.mjs';
import { snapshotWorkspace } from '../lab/lib/workspace.mjs';

const repository = path.resolve(import.meta.dirname, '..');
const suite = path.join(repository, 'datasets/ladder-agent');
const temporary = [];
const groups = { 'cart-discount': 'core', 'ttl-size-cache': 'core', 'build-scheduler': 'supreme-a', 'log-kv-store': 'supreme-a', 'rga-text-crdt': 'supreme-b', 'markdown-renderer': 'supreme-b', 'bytecode-vm': 'supreme-b', 'diff-patch': 'supreme-a' };
const workspace = slug => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-agent-repair-'));
  temporary.push(root);
  const work = path.join(root, 'work');
  fs.cpSync(path.join(suite, 'workspaces', slug), work, { recursive: true });
  fs.cpSync(path.join(repository, 'tests/fixtures/ladder-agent-solutions', groups[slug], slug), work, { recursive: true });
  return work;
};
const lib = work => import(pathToFileURL(path.join(work, 'src/index.mjs')).href);
const evaluate = (slug, work) => {
  const fixtureDir = path.join(suite, 'workspaces', slug);
  const runDir = path.join(path.dirname(work), 'run');
  fs.mkdirSync(runDir);
  const artifact = snapshotWorkspace({ fixtureDir, workDir: work, runDir, base: 'w', artifactId: 'repair', createdAt: '2026-11-16T00:00:00Z' });
  const result = runWorkspaceCheckV2({ fixtureDir, check: loadCheck(path.join(suite, 'checks'), slug), runDir, manifestPath: artifact.path });
  assert.equal(result.error, undefined, result.error);
  const { tests } = JSON.parse(fs.readFileSync(path.join(suite, 'checks', slug, 'expected.json'), 'utf8'));
  if (tests) result.results.push({ name: 'executable tests', ...runExecutableTests({ workspace: work, rule: tests }) });
  return result.results;
};
const probe = async (slug, work, name) => {
  const { probes } = await import(pathToFileURL(path.join(suite, 'checks', slug, 'probe.mjs')).href);
  const selected = probes.find(value => value.name === name);
  assert(selected, `missing probe ${name}`);
  const actual = await selected.run({ load: relative => import(pathToFileURL(path.join(work, relative)).href) });
  const expected = JSON.parse(fs.readFileSync(path.join(suite, 'checks', slug, 'expected.json'), 'utf8')).probes[name];
  return { actual, expected };
};
test.after(() => {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  let bytes = 0;
  const size = directory => fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? size(path.join(directory, entry.name)) : fs.statSync(path.join(directory, entry.name)).size), 0);
  for (const root of temporary) {
    const actual = fs.realpathSync(root);
    assert(actual.startsWith(temporaryRoot + path.sep) && path.basename(actual).startsWith('lab-agent-repair-'));
    bytes += size(actual);
    fs.rmSync(actual, { recursive: true });
  }
  console.log(JSON.stringify({ agent_repair_scratch_deleted_bytes: bytes, directories: temporary.length }));
});

test('a synchronous failed cache load releases its flight before retry', async () => {
  const { Cache, manualClock, getOrLoad } = await lib(workspace('ttl-size-cache'));
  const cache = new Cache({ clock: manualClock(0) });
  let calls = 0;
  const load = () => { if (++calls === 1) throw new Error('boom'); return 'ok'; };
  await assert.rejects(getOrLoad(cache, 'k', load), /boom/);
  assert.equal(await getOrLoad(cache, 'k', load), 'ok');
  assert.equal(calls, 2);
});

test('a cache insertion failure releases its flight before retry', async () => {
  const { getOrLoad } = await lib(workspace('ttl-size-cache'));
  let sets = 0;
  let calls = 0;
  const cache = { has: () => false, set: () => { if (++sets === 1) throw new Error('full'); } };
  const load = () => ++calls;
  await assert.rejects(getOrLoad(cache, 'k', load), /full/);
  assert.equal(await getOrLoad(cache, 'k', load), 2);
});

test('the cache check accepts an immediate loader with no registered flight after synchronous failure', () => {
  const work = workspace('ttl-size-cache');
  fs.writeFileSync(path.join(work, 'src/loader.mjs'), `const flights=new WeakMap();
export function getOrLoad(cache,key,loader,options={}){
if(cache.has(key))return Promise.resolve(cache.get(key));
if(!flights.has(cache))flights.set(cache,new Map());const pending=flights.get(cache);if(pending.has(key))return pending.get(key);
let value;try{value=loader(key);}catch(error){return Promise.reject(error);}
const flight=Promise.resolve(value).then(value=>{cache.set(key,value,options);return value;}).finally(()=>pending.delete(key));pending.set(key,flight);return flight;}`);
  assert.deepEqual(evaluate('ttl-size-cache', work).filter(result => !result.ok), []);
});

test('the cache check still rejects a synchronous failure left registered as a flight', () => {
  const work = workspace('ttl-size-cache');
  const source = path.join(work, 'src/loader.mjs');
  fs.writeFileSync(source, `const flights=new WeakMap();
export function getOrLoad(cache,key,loader,options={}){
if(cache.has(key))return Promise.resolve(cache.get(key));if(!flights.has(cache))flights.set(cache,new Map());const pending=flights.get(cache);if(pending.has(key))return pending.get(key);
const flight=(async()=>{try{const value=await loader(key);cache.set(key,value,options);return value;}finally{pending.delete(key);}})();pending.set(key,flight);return flight;}`);
  const result = evaluate('ttl-size-cache', work).find(item => item.name === 'a synchronous loader throw releases the shared load before retry');
  assert.equal(result.ok, false);
});

for (const exportForm of ['export default Cart;', 'export { Cart as default };']) test(`executable tests preserve and observe ${exportForm}`, () => {
  const work = workspace('cart-discount');
  fs.appendFileSync(path.join(work, 'src/cart.mjs'), `\n${exportForm}\n`);
  fs.writeFileSync(path.join(work, 'test/discount.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import Cart from '../src/cart.mjs';test('default discount',()=>assert.equal(new Cart().add('a',100).applyDiscount('SAVE10').total(),90));");
  assert.deepEqual(evaluate('cart-discount', work).filter(result => !result.ok), []);
});

test('build targets, dependency outputs and cache retain own special names', async () => {
  const { build } = await lib(workspace('build-scheduler'));
  const graph = Object.fromEntries([['__proto__', { source: 'input' }], ['constructor', { recipe: 'r', deps: ['__proto__'] }], ['toString', { recipe: 'r', deps: ['constructor'] }]]);
  const dependencies = [];
  const run = (name, info) => { dependencies.push([name, Object.entries(info.deps)]); return { ok: true, output: name }; };
  const result = build(graph, { run });
  assert.deepEqual(Object.keys(result.targets).sort(), ['__proto__', 'constructor', 'toString'].sort());
  assert.deepEqual(dependencies, [['constructor', [['__proto__', 'input']]], ['toString', [['constructor', 'constructor']]]]);
  assert.deepEqual(Object.keys(result.cache).sort(), ['constructor', 'toString'].sort());
  const again = build(graph, { cache: result.cache, run: () => { throw new Error('unexpected build'); } });
  assert.equal(again.stats.cached, 2);
  const builtGraph = Object.fromEntries([['toString', { source: 'input' }], ['__proto__', { recipe: 'r', deps: ['toString'] }], ['constructor', { recipe: 'r', deps: ['__proto__'] }]]);
  const built = JSON.parse(JSON.stringify(build(builtGraph, { run: (name) => ({ ok: true, output: name }) })));
  assert.deepEqual(Object.keys(built.targets).sort(), ['__proto__', 'constructor', 'toString']);
  assert.deepEqual(Object.keys(built.cache).sort(), ['__proto__', 'constructor']);
  assert.equal(build(builtGraph, { cache: built.cache, run: () => { throw new Error('unexpected build'); } }).stats.cached, 2);
});

test('RGA accepted clocks preserve parent-first DFS over sibling stamp order', async () => {
  const { createReplica } = await lib(workspace('rga-text-crdt'));
  const replica = createReplica('receiver');
  const insert = (site, clock, after, char) => ({ type: 'insert', site, seq: 1, clock, after, char });
  replica.receive([insert('a', 10, null, 'A'), insert('b', 5, null, 'B'), insert('c', 1, 'a@1', 'C')]);
  assert.equal(replica.text(), 'ACB');
  replica.receive([insert('d', 20, 'a@1', 'D'), insert('e', 30, 'c@1', 'E')]);
  assert.equal(replica.text(), 'ADCEB');
});

test('RGA arbitrary positive child clocks match an independent tree walk after shuffled delivery', async () => {
  const { createReplica } = await lib(workspace('rga-text-crdt'));
  let state = 81731;
  const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
  for (let sample = 0; sample < 50; sample += 1) {
    const operations = [];
    const children = new Map([[null, []]]);
    for (let index = 0; index < 20; index += 1) {
      const parent = random(index + 3);
      const operation = { type: 'insert', site: `s${index}`, seq: 1, clock: random(25) + 1, after: parent < index ? `s${parent}@1` : null, char: String.fromCharCode(65 + index) };
      operations.push(operation);
      children.set(`${operation.site}@1`, []);
      children.get(operation.after).push(operation);
    }
    const visit = parent => [...children.get(parent)]
      .sort((a, b) => b.clock - a.clock || (a.site < b.site ? 1 : a.site > b.site ? -1 : 0))
      .map(operation => operation.char + visit(`${operation.site}@1`)).join('');
    const expected = visit(null);
    const arrival = [...operations];
    for (let index = arrival.length - 1; index > 0; index -= 1) {
      const other = random(index + 1);
      [arrival[index], arrival[other]] = [arrival[other], arrival[index]];
    }
    const replica = createReplica('receiver');
    for (const operation of arrival) replica.receive([operation]);
    assert.equal(replica.pendingCount(), 0);
    assert.equal(replica.text(), expected, `sample ${sample}`);
  }
});

test('log batch shape and explicit null follow the published RangeError contract', async () => {
  const { openStore, MemDisk } = await lib(workspace('log-kv-store'));
  const disk = new MemDisk();
  const store = openStore(disk);
  assert.throws(() => store.batch('x'), RangeError);
  assert.throws(() => openStore(disk, { maxSegmentBytes: null }), RangeError);
  assert.deepEqual(openStore(disk, { maxSegmentBytes: undefined }).entries(), []);
});

test('comment-only replacement of the cart test file cannot earn a full score', () => {
  const work = workspace('cart-discount');
  fs.writeFileSync(path.join(work, 'test/cart.test.mjs'), '// applyDiscount\n');
  assert(evaluate('cart-discount', work).some(result => !result.ok));
});

test('a registered empty discount test is not executable discount coverage', () => {
  const work = workspace('cart-discount');
  fs.writeFileSync(path.join(work, 'test/discount.test.mjs'), "import test from 'node:test';\ntest('applyDiscount', () => {});\n");
  assert(evaluate('cart-discount', work).some(result => !result.ok));
});

test('a module-level discount call cannot stand in for execution by an added test', () => {
  const work = workspace('cart-discount');
  fs.writeFileSync(path.join(work, 'test/discount.test.mjs'), "import test from 'node:test';\nimport { Cart } from '../src/cart.mjs';\nnew Cart().applyDiscount('SAVE10');\ntest('discount coverage', () => {});\n");
  const result = evaluate('cart-discount', work).find(value => value.name === 'executable tests');
  assert.equal(result.ok, false);
  assert.deepEqual(result.details.required_call_counts, [0]);
});

for (const [name, mutation] of [
  ['Array.prototype.every', 'Array.prototype.every = () => true;'],
  ['Object.prototype.toJSON', "Object.prototype.toJSON = function () { return this.nonce ? { nonce: this.nonce, result: { ok: true } } : this; };"]
]) test(`an empty discount test cannot forge trusted accounting through ${name}`, () => {
  const work = workspace('cart-discount');
  fs.writeFileSync(path.join(work, 'test/discount.test.mjs'), `import test from 'node:test';\n${mutation}\ntest('discount coverage', () => {});\n`);
  const result = evaluate('cart-discount', work).find(value => value.name === 'executable tests');
  assert.equal(result.ok, false);
  assert.equal(result.unjudged, undefined);
  assert.deepEqual(result.details.required_call_counts, [0]);
});

test('the cart reference retains and executes the original and added tests', () => {
  const results = evaluate('cart-discount', workspace('cart-discount'));
  assert.deepEqual(results.filter(result => !result.ok), []);
});

test('executable-test observation supports TLA source and a frozen prototype', () => {
  const work = workspace('cart-discount');
  const source = path.join(work, 'src/cart.mjs');
  fs.appendFileSync(source, '\nawait Promise.resolve();\nObject.freeze(Cart.prototype);\n');
  assert.deepEqual(evaluate('cart-discount', work).filter(result => !result.ok), []);
});

test('executable-test observation counts an explicit prototype call in the added test', () => {
  const work = workspace('cart-discount');
  fs.writeFileSync(path.join(work, 'test/discount.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { Cart } from '../src/cart.mjs';\ntest('discount through the prototype', () => { const cart = new Cart().add('a', 100); Cart.prototype.applyDiscount.call(cart, 'SAVE10'); assert.equal(cart.total(), 90); });\n");
  assert.deepEqual(evaluate('cart-discount', work).filter(result => !result.ok), []);
});

test('unobservable frozen prototype calls are unjudged rather than failed tests', () => {
  const work = workspace('cart-discount');
  fs.appendFileSync(path.join(work, 'src/cart.mjs'), '\nObject.freeze(Cart.prototype);\n');
  fs.writeFileSync(path.join(work, 'test/discount.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { Cart } from '../src/cart.mjs';\ntest('discount through the prototype', () => { const cart = new Cart().add('a', 100); Cart.prototype.applyDiscount.call(cart, 'SAVE10'); assert.equal(cart.total(), 90); });\n");
  const result = evaluate('cart-discount', work).find(result => result.name === 'executable tests');
  assert.equal(result.unjudged, true, JSON.stringify(result));
});

test('prototype observation preserves private-field receiver semantics', () => {
  const work = workspace('cart-discount');
  const source = path.join(work, 'src/cart.mjs');
  fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('export class Cart {', 'export class Cart {\n  #items;\n  #code;').replaceAll('this.items', 'this.#items').replaceAll('this.code', 'this.#code'));
  fs.writeFileSync(path.join(work, 'test/discount.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { Cart } from '../src/cart.mjs';\ntest('discount through the prototype', () => { const cart = new Cart().add('a', 100); Cart.prototype.applyDiscount.call(cart, 'SAVE10'); assert.equal(cart.total(), 90); });\n");
  assert.deepEqual(evaluate('cart-discount', work).filter(result => !result.ok), []);
});

for (const expression of ['Cart.prototype', 'Object.getPrototypeOf(cart)']) test(`frozen private-field calls through ${expression} leave observation unjudged`, () => {
  const work = workspace('cart-discount');
  const source = path.join(work, 'src/cart.mjs');
  fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('export class Cart {', 'export class Cart {\n  #items;\n  #code;').replaceAll('this.items', 'this.#items').replaceAll('this.code', 'this.#code') + '\nObject.freeze(Cart.prototype);\n');
  fs.writeFileSync(path.join(work, 'test/discount.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { Cart } from '../src/cart.mjs';\ntest('discount through the prototype', () => { const cart = new Cart().add('a', 100); ${expression}.applyDiscount.call(cart, 'SAVE10'); assert.equal(cart.total(), 90); });\n`);
  const result = evaluate('cart-discount', work).find(result => result.name === 'executable tests');
  assert.equal(result.unjudged, true, JSON.stringify(result));
});

test('executable-test observation supports an instance-arrow discount method', () => {
  const work = workspace('cart-discount');
  const source = path.join(work, 'src/cart.mjs');
  const text = fs.readFileSync(source, 'utf8');
  assert(text.includes('applyDiscount(code) {'));
  fs.writeFileSync(source, text.replace('applyDiscount(code) {', 'applyDiscount = (code) => {'));
  assert.deepEqual(evaluate('cart-discount', work).filter(result => !result.ok), []);
});

test('a genuinely failing added discount test is rejected', () => {
  const work = workspace('cart-discount');
  fs.appendFileSync(path.join(work, 'test/discount.test.mjs'), "\ntest('a wrong expectation', () => assert.equal(new Cart().add('a', 10).applyDiscount('SAVE10').total(), 99));\n");
  const result = evaluate('cart-discount', work).find(result => result.name === 'executable tests');
  assert.equal(result.ok, false);
  assert.equal(result.unjudged, undefined);
  assert(result.details.failed > 0);
});

test('the executable-test driver denies workspace writes outside reads processes workers addons and SQLite', () => {
  const work = workspace('cart-discount');
  const outside = path.join(path.dirname(work), 'outside.txt');
  fs.writeFileSync(outside, 'host-owned sentinel');
  const cart = path.join(work, 'src/cart.mjs');
  const before = fs.readFileSync(cart, 'utf8');
  fs.appendFileSync(path.join(work, 'test/discount.test.mjs'), `
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
test('permissions remain restricted', async () => {
  assert.throws(() => fs.readFileSync(${JSON.stringify(outside)}), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => fs.writeFileSync(${JSON.stringify(outside)}, 'changed'), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => fs.writeFileSync(${JSON.stringify(cart)}, 'changed'), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => spawnSync(process.execPath, ['-e', '']), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => new Worker('', { eval: true }), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => process.dlopen({ exports: {} }, 'unused.node'), { code: 'ERR_DLOPEN_DISABLED' });
  await assert.rejects(import('node:sqlite'), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' });
});
`);
  assert.deepEqual(evaluate('cart-discount', work).filter(result => !result.ok), []);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'host-owned sentinel');
  assert.equal(fs.readFileSync(cart, 'utf8'), before);
});

test('a discoverable bootstrap bridge cannot authorize a fake constructor or call index', () => {
  const work = workspace('cart-discount');
  fs.writeFileSync(path.join(work, 'test/spoof.test.mjs'), `import test from 'node:test';
import assert from 'node:assert/strict';
test('a fake call', () => {
  const key = Object.getOwnPropertyNames(globalThis).find(name => name.startsWith('__lab_test_bridge_'));
  if (key) {
    try {
      const Fake = globalThis[key](class { x() {} }, [{method:'x', index:0}]);
      new Fake().x();
    } catch {}
  }
  assert.ok(true);
});
`);
  const rule = { files: ['test/spoof.test.mjs'], minimum_tests: 1, required_calls: [{ module: 'src/cart.mjs', test_file: 'test/spoof.test.mjs', export: 'Cart', method: 'applyDiscount', instance: true }] };
  const result = runExecutableTests({ workspace: work, rule });
  assert.equal(result.ok, false);
  assert.deepEqual(result.details.required_call_counts, [0]);
});

test('log recovery accepts both read-once caching strategies', async () => {
  const name = 'every segment is read at most once when a store opens';
  const lazy = await probe('log-kv-store', workspace('log-kv-store'), name);
  assert.deepEqual(lazy.actual, lazy.expected);
  const eager = workspace('log-kv-store');
  const file = path.join(eager, 'src/recovery.mjs');
  const source = fs.readFileSync(file, 'utf8');
  const needle = '  for (let i = numbers.length - 1;';
  assert(source.includes(needle));
  fs.writeFileSync(file, source.replace(needle, '  for (const number of numbers) read(number);\n\n' + needle));
  const result = await probe('log-kv-store', eager, name);
  assert.deepEqual(result.actual, result.expected);
});

test('log recovery rejects repeated segment reads and reads outside the listed segments', async () => {
  const name = 'every segment is read at most once when a store opens';
  for (const [before, after] of [
    ['if (!cache.has(number))', 'if (true)'],
    ['const names = disk.list();', "const names = disk.list(); disk.read('notes.txt');"],
  ]) {
    const work = workspace('log-kv-store');
    const file = path.join(work, 'src/recovery.mjs');
    const source = fs.readFileSync(file, 'utf8');
    assert(source.includes(before));
    fs.writeFileSync(file, source.replace(before, after));
    const result = await probe('log-kv-store', work, name);
    assert.notDeepEqual(result.actual, result.expected);
  }
});

test('log grading rejects the former TypeError batch rule and nullish option default', async () => {
  for (const [before, after, name] of [
    ["throw new RangeError('ops must be an array')", "throw new TypeError('ops must be an array')", 'a bad batch is refused before anything is written'],
    ['options.maxSegmentBytes === undefined ? 1048576 : options.maxSegmentBytes', 'options.maxSegmentBytes ?? 1048576', 'maxSegmentBytes must be an integer of at least 64'],
  ]) {
    const work = workspace('log-kv-store');
    const file = path.join(work, 'src/store.mjs');
    const source = fs.readFileSync(file, 'utf8');
    assert(source.includes(before));
    fs.writeFileSync(file, source.replace(before, after));
    const result = await probe('log-kv-store', work, name);
    assert.notDeepEqual(result.actual, result.expected);
  }
});

test('log default-segment boundary distinguishes 1048576 from 64 and an off-by-one default', async () => {
  const name = 'omitted and undefined segment limits use the exact published default';
  const reference = await probe('log-kv-store', workspace('log-kv-store'), name);
  assert.deepEqual(reference.actual, reference.expected);
  for (const wrong of [64, 1048577]) {
    const work = workspace('log-kv-store');
    const source = path.join(work, 'src/store.mjs');
    const text = fs.readFileSync(source, 'utf8');
    assert(text.includes('options.maxSegmentBytes === undefined ? 1048576 : options.maxSegmentBytes'));
    fs.writeFileSync(source, text.replace('options.maxSegmentBytes === undefined ? 1048576 : options.maxSegmentBytes', `options.maxSegmentBytes === undefined ? ${wrong} : options.maxSegmentBytes`));
    const result = await probe('log-kv-store', work, name);
    assert.notDeepEqual(result.actual, result.expected);
  }
});

for (const [slug, name] of [
  ['build-scheduler', 'own special target names survive dependencies result records and cache reuse'],
  ['bytecode-vm', 'step limits reject the same incremented call at zero and two'],
  ['markdown-renderer', 'maximal reference destinations take adjacent quotes before optional titles'],
  ['diff-patch', 'a missing final wire LF is distinct from an explicit logical no-newline marker'],
  ['rga-text-crdt', 'accepted low child clocks keep complete sibling subtrees together'],
]) test(`${slug} has an exact executable boundary example for its clarified contract`, async () => {
  const result = await probe(slug, workspace(slug), name);
  assert.deepEqual(result.actual, result.expected);
});
