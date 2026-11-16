// The page head (test name and one line of facts) and the answer: sentences, then the fairness line.
import { S, ctx, setupsOf, defaultSel, selectedCfgs, comparison, caseOf, ctxObservations } from './model.js';
import { answer } from './verdict.js';
import { testTitle, testMeta, caseName, fairLine } from './words.js';
import { html, raw, setHtml, keepParts } from './util.js';
import { visualArtifacts } from './artifacts.js';

// The answer for a test: the shown setups, or for another test its default setups.
export function verdictFor(c = ctx(), ids = null) {
  if (!c) return answer({ setups: [] });
  const list = setupsOf(ids || (c.key === S.ctxKey ? S.sel : defaultSel(c)), c);
  return answer({ setups: list, cases: c.cases.length });
}

export function caseLabel(c) {
  if (c.cases.length !== 1) return '';
  const k = caseOf(c.cases[0], c);
  return caseName(c.cases[0], c.suite.id, k && k.input);
}

// Rate answers: only on tests with pictures, with answers no check decided, or with ratings already.
export function rateWanted(c = ctx()) {
  if (!c) return false;
  const obs = ctxObservations(c.key);
  if (obs.some((o) => o.status !== 'error' && (o.passed === null || o.passed === undefined))) return true;
  if (obs.some((o) => o.status !== 'error' && visualArtifacts(o).length)) return true;
  const runIds = new Set(c.runs.map((r) => (typeof r === 'string' ? r : r.run_id)));
  return ((S.data && S.data.annotations) || []).some((a) => runIds.has(a.run_id));
}

export function renderHead() {
  const c = ctx();
  const title = document.getElementById('test-title');
  const meta = document.getElementById('test-meta');
  if (!c) {
    title.textContent = 'Results';
    meta.textContent = '';
    document.title = 'Results · Model Lab';
    return;
  }
  title.textContent = testTitle(c);
  setHtml(meta, raw(keepParts(testMeta(c, c.config_ids.length, caseLabel(c)))));
  const provenance = document.getElementById('test-provenance');
  if (provenance) provenance.textContent = `Suite ${c.suite.id}@${c.suite.version} · prompt ${c.prompt.id}@${c.prompt.version} · checks ${(c.evaluators || []).map((e) => `${e.id}@${e.version}`).join(', ') || 'none'} · context ${c.key}`;
  document.title = `${testTitle(c)} · Results · Model Lab`;
}

export function renderAnswer() {
  const host = document.getElementById('answer');
  const c = ctx();
  if (!c) return;
  if (!selectedCfgs().length) {
    host.dataset.kind = 'empty';
    setHtml(host, html`<p class="say">No selected setups remain in this test.</p><p class="say-more">Choose the setups you want to see. Your selection has not been expanded.</p><button type="button" class="btn primary" data-act="choose" data-fk="choose-empty">Choose setups</button>`);
    return;
  }
  const v = verdictFor();
  const fair = v.kind === 'single' ? null : fairLine(comparison(selectedCfgs()));
  const rate = rateWanted(c);
  host.dataset.kind = v.kind;
  setHtml(
    host,
    html`<p class="say">${v.sentences.join(' ')}</p>
    ${v.more.length ? html`<p class="say-more">${v.more.join(' ')}</p>` : ''}
    ${fair || rate || v.kind === 'single' ? html`<div class="say-foot">
      ${fair ? html`<p class="fair"><span class="mark-s ${fair.tone === 'ok' ? 'ok' : 'warn'}" aria-hidden="true"></span>${fair.text}</p>` : ''}
      ${v.kind === 'single' ? html`<p class="fair"><span class="mark-s info" aria-hidden="true"></span>One setup: a run report. <a href="/#run">Run another setup on this test</a> to compare.</p>` : ''}
      ${rate ? html`<button type="button" class="btn secondary small" data-act="rate-start" data-fk="rate-start">Rate answers</button>` : ''}
    </div>` : ''}`,
  );
}
