// Side panel: one try in full. Answer (the check first, then what the setup returned) and Evidence.
import { S, obsById, cellObs, cfgOf, caseOf, outcome, setupsOf, ctx, repeatsOf } from './model.js';
import { caseName, durText, shortDate } from './words.js';
import { errorWord } from './verdict.js';
import { html, raw, setHtml, isNum, usdText, tokText, dateTime, download } from './util.js';
import { artifactHtml, visualArtifacts } from './artifacts.js';
import { syncOpenMark } from './cases.js';
import { rateWanted } from './summary.js';

const TABS = [
  ['answer', 'Answer'],
  ['evidence', 'Evidence'],
];

let openerKey = null;
let closeTimer = 0;

const json = (v) => JSON.stringify(v, null, 2);
const nil = (text = 'none') => html`<span class="muted">${text}</span>`;
const mono = (v) => (v === null || v === undefined || v === '' ? nil() : html`<span class="mono">${v}</span>`);

function neighbors(o) {
  const same = cellObs(o.case_id, o.config_id);
  const i = same.findIndex((x) => x.id === o.id);
  const order = S.sel;
  const j = order.indexOf(o.config_id);
  const at = (cfgId) => {
    const list = cellObs(o.case_id, cfgId);
    return list.find((x) => x.repeat === o.repeat) || list[0] || null;
  };
  let prevSetup = null;
  let nextSetup = null;
  if (j >= 0) {
    for (let k = j - 1; k >= 0 && !prevSetup; k -= 1) prevSetup = at(order[k]);
    for (let k = j + 1; k < order.length && !nextSetup; k += 1) nextSetup = at(order[k]);
  }
  return { prevTry: i > 0 ? same[i - 1] : null, nextTry: i >= 0 && i < same.length - 1 ? same[i + 1] : null, prevSetup, nextSetup };
}

// What the agent changed, from the stored workspace record.
function workspaceFiles(o) {
  const a = (o.artifacts || []).find((x) => /__workspace$/.test(x.artifact_id || '') && x.content);
  if (!a) return null;
  try {
    const w = JSON.parse(a.content);
    return { changed: w.changed || [], deleted: w.deleted || [] };
  } catch {
    return null;
  }
}

function checkHtml(o) {
  const out = outcome(o);
  if (o.status === 'error') return '';
  const s = (o.scores || []).find((x) => x.dimension === 'quality') || (o.scores || [])[0];
  if (!s) return html`<section class="pane"><h3 class="pane-h">Check</h3><p class="muted">${out.kind === 'unscored' ? 'Not checked: this test has no automatic check for this answer.' : 'No check result stored.'}</p></section>`;
  const d = s.details || {};
  const results = Array.isArray(d.results) ? d.results : null;
  const head = results
    ? `${results.filter((r) => r.ok).length} of ${results.length} checks passed`
    : out.text.charAt(0).toUpperCase() + out.text.slice(1);
  const expected = d.expected !== undefined ? d.expected : null;
  const got = d.extracted !== undefined ? d.extracted : d.actual !== undefined ? d.actual : null;
  return html`<section class="pane"><h3 class="pane-h">Check <span class="mark mark-${out.kind}">${out.glyph} ${out.text}</span></h3>
    <p class="check-head">${head}<span class="muted"> · ${s.evaluator_id}</span></p>
    ${results ? html`<ul class="checks">${results.map((r) => html`<li class="${r.ok ? 'ok' : 'bad'}"><span class="ck" aria-hidden="true">${r.ok ? '✓' : '✕'}</span><span>${r.name}</span><span class="sr">${r.ok ? 'passed' : 'failed'}</span></li>`)}</ul>` : ''}
    ${expected !== null ? html`<dl class="kv"><dt>Expected</dt><dd class="mono">${typeof expected === 'string' ? expected : JSON.stringify(expected)}</dd>${got !== null ? html`<dt>Got</dt><dd class="mono">${typeof got === 'string' ? got : JSON.stringify(got)}</dd>` : ''}</dl>` : ''}
    ${d.error ? html`<p class="bad">${typeof d.error === 'string' ? d.error : JSON.stringify(d.error)}</p>` : ''}
  </section>`;
}

function answerTab(o, cfg) {
  const k = caseOf(o.case_id);
  const agent = Boolean(k && k.input && k.input.workspace != null);
  const arts = o.status === 'error' ? [] : visualArtifacts(o);
  const files = agent ? workspaceFiles(o) : null;
  const u = o.usage || {};
  const facts = [
    isNum(o.latency_ms) ? durText(o.latency_ms) : null,
    isNum(u.input_tokens) ? `${tokText(u.input_tokens)} tokens in, ${tokText(u.output_tokens)} out` : null,
    isNum(o.tool_calls) ? `${o.tool_calls} tool call${o.tool_calls === 1 ? '' : 's'}` : null,
    isNum(o.cost_usd) ? `API price ${usdText(o.cost_usd)}` : null,
  ].filter(Boolean);
  const err = o.error || {};
  const question = k ? Object.entries(k.input || {}).filter(([key]) => key !== 'workspace') : [];
  return html`
    ${o.status === 'error' ? html`<section class="pane"><h3 class="pane-h">No answer</h3><div class="errbox"><strong>${errorWord(err.type) || 'error'}</strong><span>${String(err.message || 'No message.').split('\n')[0]}</span></div></section>` : ''}
    ${checkHtml(o)}
    ${files ? html`<section class="pane"><h3 class="pane-h">Files the agent changed</h3>${files.changed.length || files.deleted.length ? html`<ul class="files">${files.changed.map((p) => html`<li><span class="mono">${p}</span></li>`)}${files.deleted.map((p) => html`<li><span class="mono">${p}</span> <span class="muted">deleted</span></li>`)}</ul>` : nil('No file changed.')}</section>` : ''}
    ${arts.length ? html`<section class="pane"><h3 class="pane-h">Picture</h3>${arts.map((a) => artifactHtml(a, `${cfg.display_name}, ${o.case_id}, try ${o.repeat + 1}`, true))}</section>` : ''}
    ${o.status !== 'error' ? html`<section class="pane"><h3 class="pane-h">${agent ? 'The agent’s summary' : 'Answer'}</h3><div class="answer-text" tabindex="0" aria-label="Answer text">${o.response && o.response.text ? o.response.text : 'No answer text.'}</div></section>` : ''}
    ${facts.length ? html`<p class="facts">${facts.join(' · ')}</p>` : ''}
    ${question.length ? html`<details class="more-box"><summary class="disclose">${agent ? 'The task' : 'The question'}</summary>
      ${question.map(([key, v]) => html`<div class="msg"><span class="msg-role">${key}</span><div class="answer-text">${typeof v === 'string' ? v : JSON.stringify(v)}</div></div>`)}
      ${k.expected !== null && k.expected !== undefined && !agent ? html`<div class="msg"><span class="msg-role">Expected</span><div class="answer-text">${typeof k.expected === 'string' ? k.expected : JSON.stringify(k.expected)}</div></div>` : ''}
    </details>` : ''}`;
}

function evidenceTab(o, cfg) {
  const run = ((S.data && S.data.runs) || []).find((r) => r.run_id === o.run_id);
  const u = o.usage || {};
  const meta = o.metadata || {};
  const params = o.request && o.request.params && Object.keys(o.request.params).length ? JSON.stringify(o.request.params) : null;
  const rows = [
    ['Run', html`${mono(o.run_id)}${run ? html`<span class="sub">${run.experiment_id || ''}${run.created_at ? ` · ${shortDate(run.created_at)}` : ''}</span>` : ''}`],
    ['Model', mono(cfg.model)],
    ['Harness', html`${cfg.harness.name} <span class="mono">${cfg.harness.version}</span>`],
    ['Effort', cfg.effort ? mono(cfg.effort) : nil('default')],
    ['User setup', cfg.user_config === 'isolated' ? 'kept out' : 'loaded'],
    ['Settings applied', params ? mono(params) : nil()],
    ['Prompt', mono(o.request ? `${o.request.prompt_id} v${o.request.prompt_version}` : null)],
    ['Case', mono(o.case_id)],
    ['Try', `${o.repeat + 1} of ${repeatsOf()}`],
    ['Started', html`<time class="mono">${o.started_at ? dateTime(o.started_at) : 'unknown'}</time>`],
    ['Time', isNum(o.latency_ms) ? durText(o.latency_ms) : nil('not measured')],
    ['Model time', isNum(o.model_request_duration_ms) ? durText(o.model_request_duration_ms) : nil('not reported')],
    ['Tokens', isNum(u.input_tokens) ? `${u.input_tokens} in · ${u.cache_read_tokens ?? 0} from cache · ${u.output_tokens} out` : nil('not reported')],
    ['Tool calls', isNum(o.tool_calls) ? String(o.tool_calls) : nil('not reported')],
    ['API price', isNum(o.cost_usd) ? usdText(o.cost_usd) : nil('not priced')],
    ['Session', mono(meta.harness_session_id)],
  ];
  return html`<dl class="kv">${rows.map(([kk, v]) => html`<dt>${kk}</dt><dd>${v}</dd>`)}</dl>
    <details class="more-box"><summary class="disclose">Everything stored for this try (JSON)</summary><div class="pre mono">${json(o)}</div></details>
    <p><button type="button" class="btn secondary small" data-act="insp-json" data-obs="${o.id}" data-fk="insp:json">Download JSON</button></p>`;
}

export function renderInspector() {
  const el = document.getElementById('inspector');
  if (!S.insp) return;
  const o = obsById(S.insp.obsId);
  const cfg = o && cfgOf(o.config_id);
  if (!o || !cfg) {
    closeInspector({ instant: true });
    return;
  }
  const c = ctx();
  const tab = S.insp.tab || 'answer';
  const out = outcome(o);
  const nb = neighbors(o);
  const k = caseOf(o.case_id);
  const name = (setupsOf(S.sel).find((s) => s.id === o.config_id) || { name: cfg.display_name }).name;
  const keep = el.querySelector('.insp-body');
  const scroll = keep && keep.dataset.obs === o.id && keep.dataset.tab === tab ? keep.scrollTop : 0;
  const total = repeatsOf();
  const navBtn = (label, target, fk) => html`<button type="button" class="btn quiet small" data-act="insp-go" data-obs="${target ? target.id : ''}" data-fk="${fk}"${target ? '' : raw(' disabled')}>${label}</button>`;
  setHtml(
    el,
    html`<div class="insp-head">
      <div class="insp-title"><h2 id="insp-title">${name}</h2>
        <p class="insp-sub">${c ? caseName(o.case_id, c.suite.id, k && k.input) : o.case_id} · try ${o.repeat + 1}${total > 1 ? ` of ${total}` : ''} · <span class="mark mark-${out.kind}">${out.glyph} ${out.text}</span></p></div>
      <button type="button" class="icon-btn" data-act="insp-close" data-fk="insp:close" aria-label="Close the side panel"><svg class="i" aria-hidden="true"><use href="#i-close"/></svg></button>
    </div>
    <div class="tabs" role="tablist" aria-label="Side panel">${TABS.map(([id, label]) => html`<button type="button" class="tab" role="tab" id="tab-${id}" data-act="insp-tab" data-tab="${id}" data-fk="insp:tab:${id}" aria-selected="${String(tab === id)}" aria-controls="insp-panel" tabindex="${tab === id ? 0 : -1}">${label}</button>`)}</div>
    <div class="insp-body" id="insp-panel" role="tabpanel" aria-labelledby="tab-${tab}" data-obs="${o.id}" data-tab="${tab}">${tab === 'answer' ? answerTab(o, cfg) : evidenceTab(o, cfg)}</div>
    <div class="insp-nav" role="group" aria-label="Another try of this case">
      ${navBtn('‹ Previous try', nb.prevTry, 'insp:prev-try')}${navBtn('Next try ›', nb.nextTry, 'insp:next-try')}
      ${S.sel.length > 1 ? html`${navBtn('‹ Previous setup', nb.prevSetup, 'insp:prev-setup')}${navBtn('Next setup ›', nb.nextSetup, 'insp:next-setup')}` : ''}
      ${rateWanted() ? html`<button type="button" class="btn secondary small insp-rate" data-act="rate" data-obs="${o.id}" data-fk="insp:rate">Rate this answer</button>` : ''}
    </div>`,
  );
  const body = el.querySelector('.insp-body');
  if (body && scroll) body.scrollTop = scroll;
  syncOpenMark();
}

export function openInspector(obsId, { instant = false, tab = 'answer', openerFk = null } = {}) {
  const el = document.getElementById('inspector');
  const wasOpen = !!S.insp;
  S.insp = { obsId, tab: wasOpen ? S.insp.tab : tab };
  if (!wasOpen) openerKey = openerFk;
  clearTimeout(closeTimer);
  renderInspector();
  if (!S.insp) return;
  el.hidden = false;
  document.body.classList.add('insp-open');
  if (wasOpen) {
    el.classList.add('is-open');
    return;
  }
  el.toggleAttribute('data-instant', instant);
  void el.offsetWidth;
  el.classList.add('is-open');
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

export function closeInspector({ instant = false } = {}) {
  const el = document.getElementById('inspector');
  if (!S.insp && el.hidden) return;
  S.insp = null;
  document.body.classList.remove('insp-open');
  syncOpenMark();
  const key = openerKey;
  openerKey = null;
  el.toggleAttribute('data-instant', instant);
  el.classList.remove('is-open');
  const finish = () => {
    el.hidden = true;
    el.innerHTML = '';
  };
  clearTimeout(closeTimer);
  if (instant) finish();
  else closeTimer = setTimeout(finish, 170);
  if (key) {
    const target = document.querySelector(`[data-fk="${CSS.escape(key)}"]`);
    if (target) target.focus({ preventScroll: true });
  }
}

export function inspectorJson(obsId) {
  const o = obsById(obsId);
  if (!o) return false;
  download(`${o.case_id}__${o.config_id}__try${o.repeat + 1}.json`, JSON.stringify(o, null, 2), 'application/json');
  return true;
}

export function tabKeys(event) {
  const tabs = [...document.querySelectorAll('#inspector [role="tab"]')];
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return false;
  let next = null;
  if (event.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
  if (event.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
  if (event.key === 'Home') next = tabs[0];
  if (event.key === 'End') next = tabs[tabs.length - 1];
  if (!next) return false;
  event.preventDefault();
  S.insp.tab = next.dataset.tab;
  renderInspector();
  const again = document.querySelector(`#inspector [data-tab="${next.dataset.tab}"][role="tab"]`);
  if (again) again.focus();
  return true;
}
