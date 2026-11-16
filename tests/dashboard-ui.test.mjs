// Render-level tests for the Results page, on the fixture repo. Layout is proved in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildState } from '../lab/lib/state.mjs';
import { S, setData, chooseContext, readHash, hashFor, defaultSel, shownSetups, chartNames, cellObs, outcome } from '../dashboard/public/js/model.js';
import { renderRatings } from '../dashboard/public/js/ratings.js';
import { renderAnswer, renderHead } from '../dashboard/public/js/summary.js';
import { renderSetups } from '../dashboard/public/js/setups.js';
import { renderCases } from '../dashboard/public/js/cases.js';
import { renderRuns } from '../dashboard/public/js/runs.js';
import { renderCharts, chartPlan } from '../dashboard/public/js/charts.js';
import { renderSetupPicker, renderTestPicker } from '../dashboard/public/js/dialogs.js';
import { csv, markdown, answerLines } from '../dashboard/public/js/exporter.js';
import { renderInspector } from '../dashboard/public/js/inspector.js';

const data = buildState(fileURLToPath(new URL('./fixtures/repo/', import.meta.url)));
const SIX = data.contexts.find((c) => c.repeats === 3).key; // smoke: 4 cases, 3 tries, 6 setups
const ONE = data.contexts.find((c) => c.suite.id === 'smoke' && c.config_ids.length === 1).key; // smoke: 1 case, 1 setup
const UNCHECKED = data.contexts.find((c) => c.suite.id === 'svg-mini').key; // pictures, no automatic check

function fakeNode(id) {
  const classes = new Set();
  return {
    id,
    innerHTML: '',
    textContent: '',
    hidden: false,
    open: false,
    dataset: {},
    attrs: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c)),
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return this.attrs[k] ?? null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}
const nodes = new Map();
const node = (id) => {
  if (!nodes.has(id)) nodes.set(id, fakeNode(id));
  return nodes.get(id);
};
const count = (text, re) => (text.match(re) || []).length;

function open(key) {
  chooseContext(key);
  S.only = null;
  S.details = false;
  S.insp = null;
  S.boardId = '';
  S.chartMetric = 'time';
  S.caseQuery = '';
  S.caseOutcomes = [];
  S.testQuery = '';
  S.setupQuery = '';
}

test.beforeEach(() => {
  nodes.clear();
  globalThis.document = { getElementById: node, querySelectorAll: () => [], querySelector: () => null, title: '' };
  globalThis.CSS = { escape: String };
  setData(structuredClone(data));
  open(SIX);
});
test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.requestAnimationFrame;
  delete globalThis.CSS;
});

test('a stored timeout renders as unfinished and unjudged rather than failed', () => {
  const cutoff = data.observations.find((row) => row.error?.type === 'timeout' && row.trusted !== false);
  assert.ok(cutoff, 'historical timeout fixture exists');
  open(cutoff.context_key);
  S.sel = [cutoff.config_id];
  assert.deepEqual(outcome(cutoff), { kind: 'incomplete', text: 'unfinished, unjudged', glyph: '◷' });
  renderSetups();
  assert.match(node('setups').innerHTML, /Unfinished/);
  assert.match(node('setups').innerHTML, /unjudged/);
  renderCases();
  assert.match(node('cases').innerHTML, /tm-incomplete/);
  assert.match(node('cases').innerHTML, /unfinished, unjudged/);
  renderRuns();
  assert.match(node('runs').innerHTML, /unfinished execution, unjudged/);
  assert.match(node('runs').innerHTML, /data-label="Answers"[^>]*><span[^>]*>11 of 12/);
  renderSetupPicker(new Set([cutoff.config_id]));
  assert.match(node('pick-setups-body').innerHTML, /unfinished, unjudged/);
});

test('the inspector distinguishes an absent verdict from an absent automatic check', () => {
  const observation = S.data.observations.find(row => row.context_key === SIX && row.status !== 'error' && row.trusted !== false);
  observation.scores = [];
  observation.passed = null;
  observation.status = 'unscored';
  S.insp = { obsId: observation.id, tab: 'answer' };
  renderInspector();
  assert.match(node('inspector').innerHTML, /No automatic verdict stored/);
  assert.doesNotMatch(node('inspector').innerHTML, /this test has no automatic check/);
});

test('the inspector labels unfinished checks as unjudged beside a proven case failure', () => {
  const observation = S.data.observations.find(row => row.context_key === SIX && row.status !== 'error' && row.trusted !== false);
  observation.scores = [{ dimension: 'quality', evaluator_id: 'workspace-tests', value: 0, passed: false, details: { results: [{ name: 'wrong', ok: false }, { name: 'unfinished', ok: false, unjudged: true }] } }];
  observation.passed = false;
  S.insp = { obsId: observation.id, tab: 'answer' };
  renderInspector();
  assert.match(node('inspector').innerHTML, /0 of 1 judged checks passed/);
  assert.match(node('inspector').innerHTML, /1 unjudged/);
  assert.match(node('inspector').innerHTML, /class="muted"[^>]*>.*?unfinished.*?unjudged/s);
});

test('an observation of a run that does not count is in no view: every view reads one index', () => {
  const first = data.observations[0];
  const before = cellObs(first.case_id, first.config_id, first.context_key).length;
  const copy = structuredClone(data);
  copy.observations.push({ ...first, id: `${first.id}-excluded`, run_id: 'excluded-run', trusted: false, status: 'error' });
  setData(copy);
  const list = cellObs(first.case_id, first.config_id, first.context_key);
  assert.equal(list.length, before);
  assert.ok(list.every((item) => item.trusted !== false));
});

test('runs: a run that does not count says why, and a run that stopped without finishing can resume', () => {
  const copy = structuredClone(data);
  const c = copy.contexts.find((item) => item.key === S.ctxKey);
  const ids = c.runs.map((r) => (typeof r === 'string' ? r : r.run_id));
  const [a, b] = copy.runs.filter((r) => ids.includes(r.run_id));
  Object.assign(a, { trust: { state: 'untrusted', scores: 'mismatch', reason: 'it is not in the ledger' } });
  Object.assign(b, { status: 'running', liveness: 'stale', resumable: true, trust: { state: 'open', scores: 'match' } });
  setData(copy);
  renderRuns();
  const markup = node('runs').innerHTML;
  assert.match(markup, /not counted: not in the ledger/);
  assert.match(markup, /Stopped without finishing/);
  assert.match(markup, new RegExp(`data-act="resume" data-run="${b.run_id}"`));
  assert.match(markup, /not counted: did not finish/);
});

test('the head names the test and counts what it holds', () => {
  renderHead();
  const meta = () => node('test-meta').innerHTML.replace(/<[^>]+>/g, '');
  assert.equal(node('test-title').textContent, 'Smoke');
  assert.ok(node('test-meta').innerHTML.includes('<span class="keep">3 tries each</span>'), 'a part never breaks inside');
  assert.match(meta(), /^4 cases · 3 tries each · 6 setups · \d{1,2} \w{3} \d{4}$/);
  open(ONE);
  renderHead();
  assert.match(meta(), /^1 case: .+ · 1 try · 1 setup · /);
  const one = S.data.contexts.find((c) => c.key === ONE);
  Object.values(one.aggregates)[0].n = 2; // a second run of the same test adds a try
  renderHead();
  assert.match(meta(), /^1 case: .+ · 2 tries each · 1 setup · /);
});

test('the answer names the leaders, the gap and the errors in words', () => {
  renderAnswer();
  const html = node('answer').innerHTML;
  assert.match(html, /<p class="say">Claude Haiku 4\.5 · claude-code \(12 of 12\), Gemini 2\.5 Flash \(11 of 11\) and GPT-5 mini \(11 of 11\) passed the most\. The other 3 setups are close enough that the gaps may be chance\.<\/p>/);
  assert.match(html, /<p class="say-more">1 answer was not checked, so it counts neither way\. GPT-5 mini had 1 unfinished try, unjudged after 2\.0 min of elapsed execution\.<\/p>/);
  assert.match(html, /Mixed test: model, harness, effort and decoding settings differ\. Read differences as hints, not causes\./);
  assert.match(html, /data-act="rate-start"/, 'an answer no check decided invites a rating');
});

test('one setup is a run report with a way to add a second one', () => {
  open(ONE);
  renderAnswer();
  const html = node('answer').innerHTML;
  assert.match(html, /One setup: a run report\./);
  assert.match(html, /href="\/#run">Run another setup on this test<\/a>/);
  assert.doesNotMatch(html, /Fair test|Mixed test/);
});

test('answers no check decided ask for ratings, never for a winner', () => {
  open(UNCHECKED);
  renderAnswer();
  const html = node('answer').innerHTML;
  assert.match(html, /<p class="say">Not scored automatically\./);
  assert.match(html, /data-act="rate-start"/);
});

test('setups: best first, only the columns with values, best values marked', () => {
  renderSetups();
  const html = node('setups').innerHTML;
  const heads = [...html.matchAll(/<th scope="col" class="c-(\w+)">([^<]+)<\/th>/g)].map((m) => m[2]);
  assert.deepEqual(heads, ['Setup', 'Passed', 'Typical time', 'Total API-equivalent price', 'Unfinished']);
  assert.equal(count(html, /<tr>/g) - 1, 6);
  const names = [...html.matchAll(/class="who-name">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(names.slice(0, 3), ['Claude Haiku 4.5', 'Gemini 2.5 Flash', 'GPT-5 mini']);
  assert.equal(count(html, /class="c-passed is-best"/g), 3);
  assert.match(html, /<span class="v">1 of 12<\/span><span class="sub">unjudged/);
  assert.match(node('setups-foot').innerHTML, /The best value in its column\./);
  assert.equal(node('choose-btn').hidden, false);
  assert.equal(node('details-btn').textContent, 'Details');
});

test('details add the slow end, the pass range and the price per pass', () => {
  S.details = true;
  renderSetups();
  const html = node('setups').innerHTML;
  for (const label of ['Slow end', 'Pass range', 'Price per pass', 'Tokens per try']) assert.match(html, new RegExp(`>${label}</th>`));
  assert.match(html, /<span class="v">\d+–100%<\/span>/);
  assert.match(node('setups-foot').innerHTML, /95% case-aware interval/);
  assert.match(node('setups-foot').innerHTML, /at least 3 counted cases/);
  assert.equal(node('details-btn').textContent, 'Hide details');
});

test('case by case: one mark per try, each one named for a screen reader', () => {
  renderCases();
  const html = node('cases').innerHTML;
  assert.equal(count(html, /<button type="button" class="tm tm-/g), 6 * 4 * 3);
  assert.match(html, /aria-label="Claude Haiku 4\.5 · claude-code, [^,]+, try 1 of 3: passed"/);
  assert.match(html, /class="tm tm-incomplete"/);
  assert.equal(node('cases-note').textContent, '4 cases');
  assert.equal(node('only-btn').attrs['aria-checked'], 'false');
});

test('only where setups differ hides the cases they agree on', () => {
  S.only = true;
  renderCases();
  const rows = count(node('cases').innerHTML, /<th scope="row" class="c-case">/g);
  assert.ok(rows >= 1 && rows <= 4, `rows: ${rows}`);
  assert.match(node('cases-note').textContent, new RegExp(`^${rows} of 4 cases differ$`));
});

test('runs: every run of the test, scored again from here, a stopped run asks twice', () => {
  renderRuns();
  const html = node('runs').innerHTML;
  const runs = S.data.runs.filter((r) => r.context_key === SIX);
  assert.equal(count(html, /data-act="score"/g), runs.length);
  assert.match(html, />Score again</);
  const stopped = S.data.runs.find((r) => r.context_key === SIX);
  stopped.harness = { ...stopped.harness, settings: { ...(stopped.harness.settings || {}), halted: 'left_workdir' } };
  renderRuns({ armed: stopped.run_id });
  const armed = node('runs').innerHTML;
  assert.match(armed, /the agent wrote outside its folder/);
  assert.match(armed, /data-force="1"[^>]*>Confirm: score it</);
  assert.match(armed, /role="alert">This run stopped early\./);
  renderRuns({ busy: true });
  assert.match(node('runs').innerHTML, /title="Wait for the current job to end\." disabled/);
});

test('ratings: every saved rating of the test, newest first, with its choice and notes', () => {
  renderRatings();
  assert.equal(node('ratings-sect').hidden, true, 'a test with no ratings hides the section');
  open(UNCHECKED);
  const [a, b] = S.data.contexts.find((c) => c.key === UNCHECKED).config_ids;
  const names = chartNames([a, b].map((id) => S.data.configs[id]));
  S.data.annotations.push({ ...S.data.annotations[0], annotation_id: 'later', created_at: '2026-10-22T08:15:00.000Z', value: null, notes: '<img src=x onerror=alert(1)>', pair_choice: 'B', pair_config_id: b, config_id: a });
  renderRatings();
  assert.equal(node('ratings-sect').hidden, false);
  assert.equal(node('ratings-note').textContent, '2 ratings');
  const html = node('ratings').innerHTML;
  assert.equal(count(html, /<tr class="rating-row">/g), 2);
  assert.ok(html.indexOf('22 Oct 2026') < html.indexOf('21 Oct 2026'), 'newest first');
  assert.match(html, /08:15 UTC/);
  assert.match(html, /House<\/span><span class="sub">try 1</);
  assert.match(html, new RegExp(`${names.get(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} was better`));
  assert.match(html, />4 of 5</);
  assert.match(html, /Clean shapes; no window\./);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});

test('charts: only charts that carry a result are main, and every width draws clean SVG', () => {
  assert.deepEqual(chartPlan().main.map((c) => c.id), ['time', 'price', 'consistency']);
  assert.deepEqual(chartPlan().more.map((c) => c.id), ['tokens', 'outcomes']);
  globalThis.requestAnimationFrame = (cb) => cb();
  node('charts-more').open = true;
  for (const width of [280, 360, 500, 660, 1100]) {
    for (const id of ['time', 'price', 'consistency', 'tokens', 'outcomes']) {
      const slots = { body: { innerHTML: '', clientWidth: width, insertAdjacentHTML(_w, s) { this.innerHTML += s; } }, note: { textContent: '' } };
      node(`chart-${id}`).querySelector = (sel) => slots[/data-slot="(\w+)"/.exec(sel)[1]];
      node(`chart-${id}`).slots = slots;
    }
    renderCharts();
    for (const id of ['time', 'price', 'consistency', 'tokens', 'outcomes']) {
      const svg = node(`chart-${id}`).slots.body.innerHTML;
      assert.match(svg, /<svg /, `${id} at ${width}`);
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${id} at ${width}`);
      assert.match(svg, /class="chart-identity"/, `${id} at ${width}`);
      if (id === 'outcomes') {
        assert.match(svg, /1 unfinished, unjudged/);
        assert.match(svg, /fill="url\(#hatch-inc\)"/);
        assert.doesNotMatch(svg, /1 no answer/);
      }
    }
  }
  open(ONE);
  assert.deepEqual(chartPlan().main, []);
  open(UNCHECKED);
  assert.deepEqual(chartPlan().main.map((c) => c.id), ['time']);
});

function drawAt(width) {
  globalThis.requestAnimationFrame = (cb) => cb();
  node('charts-more').open = true;
  for (const id of ['time', 'price', 'consistency', 'tokens', 'outcomes']) {
    const slots = { body: { innerHTML: '', clientWidth: width, insertAdjacentHTML(_w, s) { this.innerHTML += s; } }, note: { textContent: '' } };
    node(`chart-${id}`).querySelector = (sel) => slots[/data-slot="(\w+)"/.exec(sel)[1]];
    node(`chart-${id}`).slots = slots;
  }
  renderCharts();
  return (id) => node(`chart-${id}`).slots.body.innerHTML;
}

test('the price chart plots the share passed that the table shows: no answer counts as not passed', () => {
  const c = S.data.contexts.find((x) => x.key === SIX);
  const withErrors = shownSetups().filter((s) => s.facts.errors > 0);
  assert.ok(withErrors.length, 'the fixture has a setup with errors');
  const svg = drawAt(660)('price');
  const ys = [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)" r="5" class="chart-mark(?:-best)?"\/>/g)].map((m) => m[1]);
  const ph = 330 - 22 - 44;
  for (const s of shownSetups()) {
    const y = (22 + (1 - s.facts.rate) * ph).toFixed(1);
    assert.ok(ys.includes(y), `${s.name}: ${s.facts.passed} of ${s.facts.decided} should sit at y ${y}, points at ${ys}`);
  }
  assert.equal(c.config_ids.length, ys.length);
});

test('charts draw degenerate data and end: zero times, zero prices', () => {
  for (const a of Object.values(S.data.contexts.find((c) => c.key === SIX).aggregates)) Object.assign(a, { p50_latency_ms: 0, p95_latency_ms: 0, mean_cost_usd: 0 });
  for (const width of [280, 660]) {
    const svg = drawAt(width);
    for (const id of ['time', 'price']) {
      assert.match(svg(id), /<svg /, `${id} at ${width}`);
      assert.doesNotMatch(svg(id), /NaN|undefined|Infinity/, `${id} at ${width}`);
    }
  }
});

test('the time axis ends near the slowest try at every width', () => {
  globalThis.requestAnimationFrame = (cb) => cb();
  const aggs = Object.values(S.data.contexts.find((c) => c.key === SIX).aggregates);
  aggs.forEach((a, i) => Object.assign(a, { p50_latency_ms: 30000 + i * 3000, p95_latency_ms: 120000 + i * 42000 })); // slowest 5.5 min
  const slowest = Math.max(...aggs.map((a) => a.p95_latency_ms));
  const ms = { min: 60000, s: 1000, ms: 1 };
  for (const width of [200, 240, 280, 360, 500, 660, 1100]) {
    for (const id of ['time', 'price', 'consistency', 'tokens', 'outcomes']) {
      const slots = { body: { innerHTML: '', clientWidth: width, insertAdjacentHTML(_w, s) { this.innerHTML += s; } }, note: { textContent: '' } };
      node(`chart-${id}`).querySelector = (sel) => slots[/data-slot="(\w+)"/.exec(sel)[1]];
      node(`chart-${id}`).slots = slots;
    }
    renderCharts();
    const ticks = [...node('chart-time').slots.body.innerHTML.matchAll(/class="chart-axis-text"[^>]*>([\d.]+) (min|s|ms)</g)].map((m) => Number(m[1]) * ms[m[2]]);
    assert.ok(ticks.length >= 3, `ticks at ${width}: ${ticks}`);
    assert.ok(ticks.at(-1) <= slowest * 1.3, `the axis at ${width} ends at ${ticks.at(-1)} ms for a slowest try of ${slowest} ms`);
  }
});

test('axis labels never touch: price ticks in a half-width card', () => {
  S.chartMetric = 'price';
  globalThis.requestAnimationFrame = (cb) => cb();
  const aggs = Object.values(S.data.contexts.find((c) => c.key === SIX).aggregates);
  aggs.forEach((a, i) => Object.assign(a, { mean_cost_usd: 0.002 + i * 0.00244 })); // $0.002 to $0.0142: a linear axis, as in the smoke test
  const width = (s) => [...s].reduce((sum, ch) => sum + (/\d/.test(ch) ? 7.6 : ch === '.' ? 3.1 : ch === ' ' ? 2.4 : 7), 0);
  for (const w of [493, 640, 1076]) {
    for (const id of ['time', 'price', 'consistency', 'tokens', 'outcomes']) {
      const slots = { body: { innerHTML: '', clientWidth: w, insertAdjacentHTML(_w, s) { this.innerHTML += s; } }, note: { textContent: '' } };
      node(`chart-${id}`).querySelector = (sel) => slots[/data-slot="(\w+)"/.exec(sel)[1]];
      node(`chart-${id}`).slots = slots;
    }
    renderCharts();
    const labels = [...node('chart-price').slots.body.innerHTML.matchAll(/<text x="([\d.]+)" y="[\d.]+" class="chart-axis-text" text-anchor="(\w+)">(\$[^<]+)</g)]
      .map(([, x, anchor, text]) => {
        const lw = width(text);
        const left = anchor === 'start' ? Number(x) : anchor === 'end' ? Number(x) - lw : Number(x) - lw / 2;
        return { text, left, right: left + lw };
      });
    assert.ok(labels.length >= 3, `price ticks at ${w}: ${labels.map((l) => l.text)}`);
    labels.slice(1).forEach((l, i) => assert.ok(l.left >= labels[i].right + 4, `at ${w}px ${labels[i].text} touches ${l.text}`));
  }
});

test('chart text reads at 16px on a phone: 12px or more in the styles, shown 1.35 times larger below 440px', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../dashboard/public/results.css', import.meta.url), 'utf8');
  const sizes = [...css.matchAll(/^\.(chart-[\w-]+|legend \.tm)[^{]*\{[^}]*?(?:font:[^;]*?|font-size:\s*)(\d+(?:\.\d+)?)px/gm)].map((m) => [m[1], Number(m[2])]);
  assert.ok(sizes.length >= 5, `chart text rules found: ${sizes.length}`);
  for (const [name, px] of sizes) assert.ok(px >= 12, `${name} is ${px}px`);
  globalThis.requestAnimationFrame = (cb) => cb();
  for (const [width, drawn] of [[300, 222], [600, 600]]) {
    for (const id of ['time', 'price', 'consistency', 'tokens', 'outcomes']) {
      const slots = { body: { innerHTML: '', clientWidth: width, insertAdjacentHTML(_w, s) { this.innerHTML += s; } }, note: { textContent: '' } };
      node(`chart-${id}`).querySelector = (sel) => slots[/data-slot="(\w+)"/.exec(sel)[1]];
      node(`chart-${id}`).slots = slots;
    }
    renderCharts();
    const svg = node('chart-time').slots.body.innerHTML;
    assert.match(svg, new RegExp(`^<svg [^>]*width="${width}" height="\\d+" viewBox="0 0 ${drawn} \\d+"`), `the time chart at ${width}px`);
  }
});

test('the link keeps the test, a chosen set of setups, and the switch; old Compare links still open', () => {
  assert.equal(hashFor(), `#ctx=${encodeURIComponent(SIX)}`);
  const two = defaultSel(S.data.contexts.find((c) => c.key === SIX)).slice(0, 2);
  chooseContext(SIX, two);
  S.only = true;
  const h = readHash(hashFor());
  assert.deepEqual(h, { ctx: SIX, cfg: two, only: true });
  assert.deepEqual(readHash(`#view=answers&ctx=${encodeURIComponent(SIX)}&cfg=${two.join(',')}`), { ctx: SIX, cfg: two, only: null });
});

test('change test lists saved views, then tests by suite with the open one marked', () => {
  renderTestPicker();
  const html = node('pick-test-body').innerHTML;
  assert.match(html, /<h3 class="pick-h" id="pick-views-h">Saved views<\/h3>/);
  assert.match(html, /<h3 class="pick-h" id="pick-h-smoke">Smoke<\/h3>/);
  assert.match(html, /<h3 class="pick-h" id="pick-h-svg-mini">Svg mini<\/h3>/);
  assert.equal(count(html, /aria-current="true"/g), 1);
  assert.match(html, new RegExp(`data-ctx="${SIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" data-fk="[^"]+" aria-current="true"`));
});

test('the picture fits a long answer in 3 lines: smaller first, then an ellipsis', () => {
  const g = { font: '', measureText(t) { return { width: t.length * Number(/(\d+)px/.exec(this.font)[1]) * 0.5 }; } };
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const short = answerLines(g, words(15), 1000, 32, 'Sans');
  assert.deepEqual([short.size, short.lines.length], [32, 2]);
  const mid = answerLines(g, words(30), 1000, 32, 'Sans');
  assert.equal(mid.size, 28);
  assert.equal(mid.lines.join(' '), words(30), 'nothing is cut when a smaller size fits');
  const long = answerLines(g, words(80), 1000, 32, 'Sans');
  assert.deepEqual([long.size, long.lines.length], [24, 3]);
  assert.match(long.lines[2], /…$/);
  assert.ok(words(80).startsWith(long.lines.join(' ').slice(0, -1)), 'the shown text is the start of the answer');
  long.lines.forEach((ln) => assert.ok(g.measureText(ln).width <= 1000, `fits: ${ln}`));
});

test('every export of a browser module has an importer: no dead code to copy', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const pub = fileURLToPath(new URL('../dashboard/public/', import.meta.url));
  const here = fileURLToPath(new URL('./', import.meta.url));
  const files = [...(await readdir(pub)).filter((f) => f.endsWith('.js')), ...(await readdir(`${pub}js`)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)];
  const sources = new Map();
  for (const f of files) sources.set(f, await readFile(pub + f, 'utf8'));
  for (const f of (await readdir(here)).filter((f) => f.endsWith('.mjs'))) sources.set(`tests/${f}`, await readFile(here + f, 'utf8'));
  const imports = [...sources].flatMap(([file, src]) => [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)].map(([, names, from]) => ({ file, from, names: names.split(',').map((n) => n.trim().split(/\s+as\s+/)[0]) })));
  const unused = [];
  for (const f of files) {
    const base = f.split('/').pop();
    for (const [, name] of sources.get(f).matchAll(/^export (?:async function|function|const|let|class) (\w+)/gm)) {
      if (!imports.some((i) => i.file !== f && i.from.endsWith(`/${base}`) && i.names.includes(name))) unused.push(`${f} ${name}`);
    }
  }
  assert.deepEqual(unused, []);
});

test('exports say what the page says', () => {
  const md = markdown();
  assert.match(md, /^## Smoke\n\n4 cases · 3 tries each · 6 setups/);
  assert.match(md, /\| Setup \| Harness \| Passed \| Typical time \| Slow end \| API price \| Errors \|/);
  assert.match(md, /\| Claude Haiku 4\.5 \| claude-code [^|]+\| \*\*12 of 12\*\* \|/);
  const rows = csv().trim().split('\n');
  assert.equal(rows.length, 7);
  assert.match(rows[0], /^setup,model,harness,harness_version,effort,user_setup,tries,passed,checked,not_checked,errors,pass_share/);
  const header = rows[0].split(',');
  const cutoff = rows.find((line) => line.startsWith('GPT-5 mini,')).split(',');
  assert.equal(cutoff[header.indexOf('checked')], '11');
  assert.equal(cutoff[header.indexOf('errors')], '0');
  assert.equal(cutoff[header.indexOf('unfinished')], '1');
  assert.equal(cutoff[header.indexOf('unfinished_elapsed_ms')], '120000');
  assert.match(md, /\| Unfinished \|/);
  assert.match(md, /1 unjudged · 2\.0 min elapsed/);
});

test('every browser script parses as a module', async () => {
  const { readdirSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const root = fileURLToPath(new URL('../dashboard/public/', import.meta.url));
  const files = readdirSync(root, { recursive: true }).filter((f) => String(f).endsWith('.js'));
  assert.ok(files.length > 10, `scripts found: ${files.length}`);
  for (const f of files) {
    const out = spawnSync(process.execPath, ['--check', `${root}${f}`], { encoding: 'utf8' });
    assert.equal(out.status, 0, `${f}: ${out.stderr.split('\n').find((l) => /Error/.test(l))}`);
  }
});
