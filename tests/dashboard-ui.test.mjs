// Render-level regression coverage. Pixel layout is verified separately in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildState } from '../lab/lib/state.mjs';
import { S, setData, chooseContext, cellObs } from '../dashboard/public/js/model.js';
import { renderLeaderboard } from '../dashboard/public/js/leaderboard.js';
import { renderAnswers } from '../dashboard/public/js/answers.js';
import { renderRuns } from '../dashboard/public/js/runs.js';
import { renderReviewView } from '../dashboard/public/js/reviewview.js';
import { renderCharts } from '../dashboard/public/js/charts.js';

const data = buildState(fileURLToPath(new URL('./fixtures/repo/', import.meta.url)));
const nodes = new Map();
const node = (id) => {
  if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '' });
  return nodes.get(id);
};

test.beforeEach(() => {
  nodes.clear();
  globalThis.document = { getElementById: node };
  setData(structuredClone(data));
  chooseContext(data.contexts.find((c) => c.repeats === 3).key);
  S.only = S.fails = false;
  S.rep = 'all';
  S.sort = { key: null, dir: 'desc' };
  S.runStatus = 'all';
  S.lat = 'harness';
  S.insp = null;
});
test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.requestAnimationFrame;
});

test('an observation of a run that does not count is in no view: answers, filters, inspector and review read one index', () => {
  const first = data.observations[0];
  const before = cellObs(first.case_id, first.config_id, first.context_key).length;
  const copy = structuredClone(data);
  copy.observations.push({ ...first, id: `${first.id}-excluded`, run_id: 'excluded-run', trusted: false, status: 'error' });
  setData(copy);
  const list = cellObs(first.case_id, first.config_id, first.context_key);
  assert.equal(list.length, before);
  assert.ok(list.every((item) => item.trusted !== false));
});

test('leaderboard explains green, labels every metric and keeps header sublabels out of accessible names', () => {
  renderLeaderboard();
  assert.match(node('lb-note').textContent, /Green = best in column/);
  const markup = node('lb').innerHTML;
  assert.match(markup, /class="th-sub" aria-hidden="true">latency/);
  assert.match(markup, /aria-label="Sort by p50 latency"/);
  assert.doesNotMatch(markup, /latency latency|not billed not billed/);
  for (const key of ['quality', 'pass', 'errors', 'p50', 'p95', 'cost', 'cpp', 'tokens']) {
    assert.match(markup, new RegExp(`class="col-num metric-${key}`));
  }
  assert.match(markup, /data-label="Tokens \(mean per call\)"/);
});

test('answers have complete model/harness identities in headers and stacked cells', () => {
  renderAnswers();
  const markup = node('ans').innerHTML;
  assert.match(markup, /--grid-min:910px/);
  assert.match(markup, /class="answer-identity"/);
  assert.match(markup, /class="cell-name">Claude Haiku 4.5<\/span>/);
  assert.match(markup, /claude-code <span class="mono">/);
  assert.match(markup, /anthropic-api <span class="mono">/);
  assert.doesNotMatch(markup, /class="cell-name">Claude Haiku 4.5 · (?:claude|anthropic)/);
});

test('runs expose IDs and secondary columns through accessible details without dropping status or counts', () => {
  renderRuns();
  const markup = node('runs-body').innerHTML;
  assert.equal((markup.match(/<details class="run-details">/g) || []).length, data.runs.length);
  assert.match(markup, /<dt>Run ID<\/dt>/);
  assert.match(markup, /<dt>Harness<\/dt>/);
  assert.match(markup, /<dt>Models<\/dt>/);
  assert.match(markup, /data-label="Rows" class="col-num"/);
  assert.match(markup, /data-label="Errors" class="col-num"/);
  assert.match(markup, /data-label="Status" class="run-status"/);
});

test('empty review pairs its start control with an actionable local empty state', () => {
  S.data.annotations = [];
  renderReviewView();
  assert.match(node('rev-body').innerHTML, /review-workspace is-empty/);
  assert.match(node('rev-body').innerHTML, /Your saved ratings and notes will appear here/);
  assert.match(node('rev-body').innerHTML, /data-act="review-start"/);
});

test('charts keep full identities, separate scatter callouts/legend, and render all widths without invalid geometry', () => {
  S.view = 'charts';
  globalThis.requestAnimationFrame = (cb) => cb();
  for (const width of [280, 360, 500, 660, 1100]) {
    for (const id of ['scatter', 'latency', 'tokens', 'reliability', 'errors']) {
      const slots = Object.fromEntries(['body', 'n', 'note'].map((key) => [key, { innerHTML: '', textContent: '', clientWidth: width, insertAdjacentHTML(_where, s) { this.innerHTML += s; } }]));
      node(`chart-${id}`).querySelector = (selector) => slots[/data-slot="(\w+)"/.exec(selector)?.[1]] || {};
      node(`chart-${id}`).slots = slots;
    }
    renderCharts();
    for (const id of ['scatter', 'latency', 'tokens', 'reliability', 'errors']) {
      const svg = node(`chart-${id}`).slots.body.innerHTML;
      assert.match(svg, /<svg /, `${id} at ${width}`);
      assert.doesNotMatch(svg, /NaN|undefined|…/, `${id} at ${width}`);
      assert.match(svg, /class="chart-identity"/);
      assert.match(svg, /Claude Haiku/);
    }
    assert.match(node('chart-scatter').slots.body.innerHTML, /class="chart-callout"/);
  }
});
