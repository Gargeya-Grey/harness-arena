import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildState } from '../lab/lib/state.mjs';
import { S, setData, ctx, chooseContext, cellObs, outcome, readHash, hashFor } from '../dashboard/public/js/model.js';
import { renderCases } from '../dashboard/public/js/cases.js';
import { renderSetups } from '../dashboard/public/js/setups.js';
import { renderCharts } from '../dashboard/public/js/charts.js';
import { renderSetupPicker, renderTestPicker, orderChosen } from '../dashboard/public/js/dialogs.js';
import { renderRuns } from '../dashboard/public/js/runs.js';
import { passInterval, passRangeText, metricCoverage } from '../dashboard/public/js/chart-data.js';

const fixture = buildState(fileURLToPath(new URL('./fixtures/repo/', import.meta.url)));
const SIX = fixture.contexts.find((c) => c.suite.id === 'smoke' && c.config_ids.length === 6).key;
const ONE = fixture.contexts.find((c) => c.suite.id === 'smoke' && c.config_ids.length === 1).key;
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
function chart(metric, width = 660) {
  S.chartMetric = metric;
  for (const id of ['time', 'price', 'consistency', 'tokens', 'outcomes']) {
    const slots = { body: { innerHTML: '', clientWidth: width, insertAdjacentHTML(_where, html) { this.innerHTML += html; } }, note: { textContent: '' } };
    node(`chart-${id}`).querySelector = (sel) => slots[/data-slot="(\w+)"/.exec(sel)[1]];
    node(`chart-${id}`).slots = slots;
  }
  renderCharts();
  return node(`chart-${metric}`).slots;
}
const shownNames = () => [...node('cases').innerHTML.matchAll(/<span class="case-name">([^<]+)<\/span>/g)].map((m) => m[1]);

test.beforeEach(() => {
  nodes.clear();
  globalThis.document = { getElementById: node, querySelectorAll: () => [], querySelector: () => null, title: '' };
  globalThis.CSS = { escape: String };
  globalThis.requestAnimationFrame = (cb) => cb();
  setData(structuredClone(fixture));
  chooseContext(SIX);
  Object.assign(S, { only: false, caseQuery: '', caseOutcomes: [], testQuery: '', setupQuery: '', chartMetric: 'time', details: false, insp: null, boardId: '' });
});
test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.CSS;
  delete globalThis.requestAnimationFrame;
});

test('case outcome union intersects name/id search and difference filtering without changing aggregates', () => {
  const before = JSON.stringify(ctx().aggregates);
  S.caseOutcomes = ['incomplete', 'unscored'];
  renderCases();
  const expected = ctx().cases.filter((id) => S.sel.some((cfg) => cellObs(id, cfg).some((o) => ['incomplete', 'unscored'].includes(outcome(o).kind))));
  assert.equal(shownNames().length, expected.length);
  assert.match(node('cases-matches').textContent, new RegExp(`^${expected.length} of 4 cases match`));
  S.caseQuery = expected[0];
  S.only = true;
  renderCases();
  assert.equal(shownNames().length, 1);
  assert.match(node('cases-note').textContent, /cases differ/);
  S.caseQuery = 'no such case';
  renderCases();
  assert.match(node('cases').innerHTML, /No case rows match/);
  assert.match(node('cases').innerHTML, /Summary and charts still use all 4 cases/);
  assert.equal(JSON.stringify(ctx().aggregates), before);
});

test('missing evidence, failed checks, no answers, unfinished and unchecked remain separate filters', () => {
  const ids = ctx().cases;
  const config = S.sel[0];
  S.sel = [config];
  const copy = structuredClone(S.data);
  for (const row of copy.observations.filter((o) => o.context_key === SIX && o.config_id === config)) {
    if (row.case_id === ids[0]) Object.assign(row, { status: 'error', error: { type: 'exit', message: 'failed' }, error_class: 'failed', quality: null, passed: null });
    if (row.case_id === ids[1]) Object.assign(row, { status: 'scored', error: null, error_class: null, quality: 0, passed: false });
    if (row.case_id === ids[2]) Object.assign(row, { status: 'error', error: { type: 'timeout' }, error_class: 'incomplete', quality: null, passed: null });
    if (row.case_id === ids[3]) Object.assign(row, { status: 'unscored', error: null, error_class: null, quality: null, passed: null });
  }
  setData(copy);
  for (const [kind, text] of [['error', 'no answer'], ['fail', 'failed'], ['incomplete', 'unfinished, unjudged'], ['unscored', 'not checked']]) {
    S.caseOutcomes = [kind];
    renderCases();
    assert.equal(shownNames().length, 1, kind);
    assert.match(node('cases').innerHTML, new RegExp(text));
  }
  copy.observations = copy.observations.filter((row) => row.case_id !== ids[0] || row.config_id !== config || row.context_key !== SIX);
  setData(copy);
  S.caseOutcomes = ['none'];
  renderCases();
  assert.equal(shownNames().length, 1);
  assert.match(node('cases').innerHTML, /no included try; missing or excluded record/);
  assert.doesNotMatch(node('cases').innerHTML, /tm-error/);
});

test('filters survive data refresh and links, then reset when the test changes', () => {
  Object.assign(S, { caseQuery: 'smoke-002', caseOutcomes: ['fail', 'incomplete'], only: true });
  const linked = readHash(hashFor());
  assert.equal(linked.query, S.caseQuery);
  assert.deepEqual(linked.outcomes, S.caseOutcomes);
  setData(structuredClone(fixture));
  chooseContext(SIX, S.sel);
  assert.equal(S.caseQuery, 'smoke-002');
  assert.deepEqual(S.caseOutcomes, ['fail', 'incomplete']);
  chooseContext(ONE);
  assert.equal(S.caseQuery, '');
  assert.deepEqual(S.caseOutcomes, []);
  assert.equal(S.only, null);
});

test('the setup range and price whisker use the API case-aware interval of four cases', () => {
  const a = ctx().aggregates[S.sel[0]];
  assert.equal(a.counted_n, 12);
  assert.equal(a.cases_n, 4);
  assert.equal(passRangeText(a), '51–100%');
  assert.deepEqual(passInterval(a), a.pass_rate_ci);
  S.details = true;
  renderSetups();
  assert.match(node('setups').innerHTML, /51–100%/);
  assert.doesNotMatch(node('setups').innerHTML, /76–100%/);
  const price = chart('price');
  const lowY = (22 + (1 - a.pass_rate_ci[0]) * (330 - 22 - 44)).toFixed(1);
  assert.match(price.body.innerHTML, new RegExp(`y1="${lowY}"[^>]+y2="22.0"[^>]+class="chart-whisker-best"`));
  assert.match(node('charts-main').innerHTML, /12 decided tries across 4 cases/);
  assert.match(node('charts-main').innerHTML, /API-equivalent USD per priced try/);
  assert.match(node('setups').innerHTML, /Total API-equivalent price/);
});

test('one-case uncertainty is unavailable with a visible reason and no fabricated whisker', () => {
  chooseContext(ONE);
  S.details = true;
  renderSetups();
  assert.match(node('setups').innerHTML, /Unavailable: 1 counted case; at least 3 needed/);
  const price = chart('price');
  assert.doesNotMatch(price.body.innerHTML, /class="chart-whisker/);
  assert.match(price.note.textContent, /at least 3 needed/);
  assert.match(node('charts-main').innerHTML, /Unavailable: 1 counted case/);
});

test('metric samples follow exact numeric coverage across attempts and agreement includes failures and unchecked outcomes', () => {
  const row = (case_id, values = {}) => ({ case_id, trusted: true, error: null, latency_ms: 100, usage: { input_tokens: 5, output_tokens: 2, cache_read_tokens: 0 }, cost_usd: 0.1, ...values });
  const rows = [
    row('failure', { error: {}, error_class: 'failed' }), row('failure', { error: {}, error_class: 'failed' }),
    row('unchecked', { quality: null, passed: null }), row('unchecked', { usage: { output_tokens: 2 } }),
    row('cutoff', { error: {}, error_class: 'incomplete', latency_ms: 90000, cost_usd: 0.2 }),
    row('lost', { error: {}, error_class: 'lost', usage: null, cost_usd: null }),
    row('single', { latency_ms: null, usage: null }),
    row('excluded', { trusted: false }),
  ];
  assert.deepEqual(metricCoverage(rows), { stored: 8, included: 7, notCounted: 1, timed: 2, timeMissing: 1, timeNoAnswer: 3, incomplete: 1, cost: 6, tokens: { input_tokens: 4, output_tokens: 5, cache_read_tokens: 4 }, repeatedCases: 2, repeatedTries: 4, consistencyExcluded: 3 });
  chart('time');
  assert.match(node('charts-main').innerHTML, /11 timed tries; 1 unfinished excluded/);
  assert.match(node('charts-main').innerHTML, /unfinished elapsed time kept separate/);
  const agreement = chart('consistency');
  assert.match(agreement.note.textContent, /Repeated failed calls and unchecked outcomes can agree/);
});

test('one selected full-width metric has a matching semantic table and unavailable metrics explain the fallback', () => {
  chart('tokens');
  assert.equal((node('charts-main').innerHTML.match(/class="chart-card"/g) || []).length, 1);
  assert.match(node('charts-main').innerHTML, /<caption>Tokens per try: values, sample and exclusions for all cases<\/caption>/);
  assert.match(node('charts-main').innerHTML, /<th scope="col">Input tokens per try/);
  assert.match(node('charts-main').innerHTML, /<span class="lt">A<\/span>/);
  assert.match(node('charts-main').innerHTML, /<span class="lt">F<\/span>/);
  assert.match(node('charts-more-label').innerHTML, /All charts/);
  chooseContext(ONE);
  chart('consistency');
  assert.equal(node('chart-fallback').hidden, false);
  assert.match(node('chart-fallback').textContent, /Consistency is unavailable/);
  assert.match(node('chart-fallback').textContent, /at least two included outcomes/);
});

test('setup search preserves hidden selections and separates matching counts from selection counts', () => {
  const chosen = new Set(S.sel);
  S.setupQuery = 'claude';
  renderSetupPicker(chosen);
  assert.match(node('pick-setups-count').textContent, /6 of 6 selected · 2 match · 4 selected outside matches/);
  assert.equal(orderChosen(chosen).length, 6);
  S.setupQuery = 'does-not-exist';
  renderSetupPicker(chosen);
  assert.match(node('pick-setups-body').innerHTML, /Your selection is kept/);
  assert.equal(chosen.size, 6);
  S.setupQuery = '';
  renderSetupPicker(chosen);
  assert.equal((node('pick-setups-body').innerHTML.match(/ checked/g) || []).length, 6);
});

test('test search retains exact versions and makes unavailable saved-view reasons visible', () => {
  S.data.boards.push({ board_id: 'missing-view', title: 'Missing view', configs: [], context: { suite: 'gone', prompt: 'gone', repeats: 1, cases: [] } });
  S.testQuery = 'missing';
  renderTestPicker();
  assert.match(node('pick-test-body').innerHTML, /disabled/);
  assert.match(node('pick-test-body').innerHTML, /<p class="pick-unavailable">Unavailable: its test has no stored runs now/);
  S.testQuery = 'smoke';
  renderTestPicker();
  assert.match(node('pick-test-body').innerHTML, /smoke@/);
  assert.match(node('pick-test-body').innerHTML, /qa-single-turn@1/);
  assert.match(node('pick-test-body').innerHTML, /exact-match@1/);
  assert.match(node('test-matches').textContent, /tests/);
});

test('test search finds a stored comparison by its harness, model and effort', () => {
  for (const query of ['codex', 'gpt-5-mini-high', 'high']) {
    S.testQuery = query;
    renderTestPicker();
    assert(node('pick-test-body').innerHTML.includes(`data-ctx="${SIX}"`), `${query} finds the Smoke comparison`);
  }
});

test('problematic history defaults open, keeps problem counts when closed and respects an explicit fold choice on refresh', () => {
  const run = S.data.runs.find((r) => r.context_key === SIX);
  Object.assign(run, { status: 'failed', execution_status: 'incomplete', incomplete_n: 1, trust: { state: 'halted', scores: 'mismatch' } });
  renderRuns();
  assert.equal(node('runs-details').open, true);
  assert.match(node('runs-problems').textContent, /1 failed/);
  assert.match(node('runs-problems').textContent, /unfinished/);
  assert.match(node('runs-problems').textContent, /guard-blocked/);
  assert.match(node('runs-problems').textContent, /unscored or scores excluded/);
  assert.match(node('runs-problems').textContent, /not counted/);
  node('runs-details').open = false;
  renderRuns();
  assert.equal(node('runs-details').open, false);
  chooseContext(ONE);
  renderRuns();
  assert.equal(node('runs-details').open, false);
});
