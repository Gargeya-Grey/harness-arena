import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildState } from '../lab/lib/state.mjs';
import { S, setData, ctx, chooseContext, letterOf, hashFor, readHash } from '../dashboard/public/js/model.js';
import { renderSetups } from '../dashboard/public/js/setups.js';
import { renderSetupPicker, orderChosen } from '../dashboard/public/js/dialogs.js';
import { renderRuns, renderDeleteRun, deleteStoredRun } from '../dashboard/public/js/runs.js';
import { renderInspector, renderVisualOutputs } from '../dashboard/public/js/inspector.js';

const fixture = buildState(fileURLToPath(new URL('./fixtures/repo/', import.meta.url)));
const SIX = fixture.contexts.find((c) => c.suite.id === 'smoke' && c.config_ids.length === 6).key;
const SVG = fixture.contexts.find((c) => c.suite.id === 'svg-mini').key;
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) {
    const classes = new Set();
    nodes.set(id, { id, innerHTML: '', textContent: '', hidden: false, open: false, value: '', dataset: {}, attrs: {},
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c) },
      setAttribute(k, v) { this.attrs[k] = String(v); }, querySelectorAll: () => [], querySelector: () => null });
  }
  return nodes.get(id);
}

test.beforeEach(() => {
  nodes.clear();
  globalThis.document = { getElementById: node, querySelectorAll: () => [], querySelector: () => null, title: '' };
  globalThis.CSS = { escape: String };
  setData(structuredClone(fixture));
  chooseContext(SIX);
  Object.assign(S, { only: false, caseQuery: '', caseOutcomes: [], setupQuery: '', setupHarness: '', setupEffort: '', section: 'overview', insp: null, details: false });
});
test.afterEach(() => { delete globalThis.document; delete globalThis.CSS; });

test('harness and exact effort are separate visible tags in setup rows and the picker', () => {
  renderSetups();
  renderSetupPicker(new Set(S.sel));
  for (const id of ['setups', 'pick-setups-body']) {
    assert.match(node(id).innerHTML, /class="setup-tag tag-harness" data-harness="codex"/);
    assert.match(node(id).innerHTML, /class="setup-tag tag-effort" data-effort="high"/);
    assert.match(node(id).innerHTML, /<span class="tag-label">Harness<\/span>/);
    assert.match(node(id).innerHTML, /<span class="tag-label">Effort<\/span>high/);
  }
});

test('harness, effort and search intersect without changing hidden selections or setup letters', () => {
  const chosen = new Set(S.sel);
  const letters = S.sel.map(letterOf);
  S.setupHarness = 'codex';
  S.setupEffort = 'high';
  S.setupQuery = 'gpt';
  renderSetupPicker(chosen);
  assert.equal((node('pick-setups-body').innerHTML.match(/data-act="choose-tick"/g) || []).length, 1);
  assert.match(node('pick-setups-count').textContent, /6 of 6 selected · 1 match · 5 selected outside matches/);
  assert.deepEqual(orderChosen(chosen), S.sel);
  assert.deepEqual(S.sel.map(letterOf), letters);
  assert.match(node('setup-filters').innerHTML, /<select id="setup-harness"[^>]*><button><selectedcontent>/);
  S.setupEffort = 'does-not-exist';
  renderSetupPicker(chosen);
  assert.match(node('pick-setups-body').innerHTML, /Your selection is kept/);
  assert.equal(chosen.size, 6);
  setData(structuredClone(fixture));
  chooseContext(SIX, S.sel);
  assert.equal(S.setupHarness, 'codex');
  assert.equal(S.setupEffort, 'does-not-exist');
});

test('section links preserve test, chosen setups and row filters, and reject unknown section names', () => {
  Object.assign(S, { custom: true, caseQuery: 'smoke-001', caseOutcomes: ['fail'], section: 'visuals' });
  const h = readHash(hashFor());
  assert.equal(h.ctx, SIX);
  assert.deepEqual(h.cfg, S.sel);
  assert.equal(h.query, 'smoke-001');
  assert.deepEqual(h.outcomes, ['fail']);
  assert.equal(h.section, 'visuals');
  assert.equal(readHash('#section=javascript%3Aalert(1)').section, undefined);
});

test('a context removed on refresh stays empty instead of displaying another test', () => {
  const original = S.ctxKey;
  const next = structuredClone(S.data);
  next.contexts = next.contexts.filter((c) => c.key !== original);
  setData(next);
  chooseContext(original, S.sel, { fallback: false });
  assert.equal(ctx(), null);
  assert.equal(S.ctxKey, original);
  assert.deepEqual(S.sel, []);
  assert.equal(S.custom, false);
});
test('deleting the only selected setup keeps an explicit empty selection inside a surviving context', () => {
  const chosen = S.sel[0];
  chooseContext(SIX, [chosen]);
  const next = structuredClone(S.data);
  next.contexts.find(c => c.key === SIX).config_ids = next.contexts.find(c => c.key === SIX).config_ids.filter(id => id !== chosen);
  delete next.configs[chosen];
  setData(next);
  chooseContext(S.ctxKey, S.custom ? S.sel : null, { fallback: !S.ctxKey });
  assert.equal(ctx().key, SIX);
  assert.deepEqual(S.sel, []);
  assert.equal(S.custom, true);
  chooseContext(S.ctxKey, S.custom ? S.sel : null, { fallback: !S.ctxKey });
  assert.deepEqual(S.sel, [], 'subsequent refreshes keep the explicit empty selection');
});

test('run actions offer review-only rerun and exact-run deletion with human context', () => {
  renderRuns();
  const r = S.data.runs.find((run) => run.context_key === SIX);
  assert.match(node('runs').innerHTML, new RegExp(`href="/\\?rerun=${encodeURIComponent(r.run_id)}#run"`));
  assert.match(node('runs').innerHTML, /data-act="delete-run"/);
  assert.match(node('runs').innerHTML, /Check stored answers/);
  assert.equal(renderDeleteRun(r.run_id), true);
  assert.equal(node('delete-run-confirm').dataset.run, r.run_id);
  assert(node('delete-run-detail').innerHTML.includes(r.run_id));
  assert(node('delete-run-detail').innerHTML.includes(r.experiment_id));
  assert.match(node('delete-run-detail').innerHTML, /Harness/);
  assert.match(node('delete-run-detail').innerHTML, /Effort/);
  assert.equal(renderDeleteRun('unknown'), false);
});

test('delete sends the exact ID twice and exposes storage lock and idle-job errors', async () => {
  const id = '20261116T010000Z__demo__test__abcdef';
  let requested;
  const result = await deleteStoredRun(id, async (url, init) => {
    requested = { url, ...init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ run_id: id, bytes_deleted: 123 }) };
  });
  assert.deepEqual(requested.body, { run_id: id, confirm: id });
  assert.equal(requested.url, '/api/storage/delete');
  assert.equal(requested.method, 'POST');
  assert.equal(requested.headers['Content-Type'], 'application/json');
  assert.equal(result.bytes_deleted, 123);
  await assert.rejects(deleteStoredRun(id, async () => ({ ok: false, status: 409, json: async () => ({ error: 'The run store is locked. Wait for the current job.' }) })), /run store is locked/);
  await assert.rejects(deleteStoredRun(id, async () => ({ ok: false, status: 400, json: async () => ({ error: 'One retained file is locked', partial: { run_id: id, bytes_deleted: 42, deleted: ['copied-fixture-only'] } }) })), (error) => error.partial?.bytes_deleted === 42);
});

test('retained screenshot and raw SVG both stay visible, while HTML opens only in the sandboxed output tab', () => {
  chooseContext(SVG);
  const o = S.data.observations.find((row) => row.context_key === SVG);
  const a = o.artifacts[0];
  o.artifacts.push({ ...a, artifact_id: 'screenshot', kind: 'image', role: 'render', derived: true, url: '/api/artifact?run_id=demo&path=screenshot.png' });
  o.artifacts.push({ ...a, artifact_id: 'html', kind: 'html', role: 'raw', url: '/api/artifact?run_id=demo&path=output.html' });
  o.artifacts.push({ ...a, artifact_id: 'bad-url', kind: 'image', url: 'javascript:alert(1)' });
  setData(S.data);
  renderVisualOutputs();
  assert.match(node('visuals').innerHTML, /Saved screenshot/);
  assert.match(node('visuals').innerHTML, /screenshot.png/);
  assert.match(node('visuals').innerHTML, /output.svg/);
  assert.match(node('visuals').innerHTML, /Stored HTML page/);
  assert.doesNotMatch(node('visuals').innerHTML, /<iframe|javascript:alert/);
  assert.match(node('visuals').innerHTML, /Retained file reference is unavailable/);
  S.insp = { obsId: o.id, tab: 'output' };
  renderInspector();
  assert.match(node('inspector').innerHTML, /sandbox="allow-scripts"/);
  assert.doesNotMatch(node('inspector').innerHTML, /allow-same-origin|javascript:alert/);
  assert.match(node('inspector').innerHTML, /Saved screenshot/);
});

test('text-only answers say when no visual artifact was retained', () => {
  renderVisualOutputs();
  assert.match(node('visuals').innerHTML, /No retained visual files/);
  assert.match(node('visuals').innerHTML, /summary alone does not provide a visual preview/);
});
