// Inspector drawer: one observation in full, in three tabs.
import { S, obsById, cellObs, cfgOf, caseOf, outcome, letterOf } from './model.js';
import { html, raw, setHtml, isNum, NA, msHtml, usdHtml, tokText, fixed, dateTime, download } from './util.js';
import { artifactHtml, visualArtifacts } from './artifacts.js';
import { syncOpenChip } from './answers.js';

const TABS = [
  ['answer', 'Answer'],
  ['metrics', 'Metrics'],
  ['provenance', 'Provenance'],
];

let openerKey = null;
let closeTimer = 0;

const json = (v) => JSON.stringify(v, null, 2);
const dd = (v) => (v === null || v === undefined || v === '' ? html`<span class="muted">${NA}</span>` : v);

function neighbors(o) {
  const sameCfg = cellObs(o.case_id, o.config_id);
  const i = sameCfg.findIndex((x) => x.id === o.id);
  const prevRep = i > 0 ? sameCfg[i - 1] : null;
  const nextRep = i >= 0 && i < sameCfg.length - 1 ? sameCfg[i + 1] : null;
  const order = S.sel;
  const j = order.indexOf(o.config_id);
  const at = (cfgId) => {
    const list = cellObs(o.case_id, cfgId);
    return list.find((x) => x.repeat === o.repeat) || list[0] || null;
  };
  let prevCfg = null;
  let nextCfg = null;
  if (j >= 0) {
    for (let k = j - 1; k >= 0 && !prevCfg; k -= 1) prevCfg = at(order[k]);
    for (let k = j + 1; k < order.length && !nextCfg; k += 1) nextCfg = at(order[k]);
  }
  return { prevRep, nextRep, prevCfg, nextCfg };
}

function answerTab(o, cfg) {
  const k = caseOf(o.case_id);
  const out = outcome(o);
  const arts = visualArtifacts(o);
  const msgs = (o.request && o.request.messages) || [];
  const human = o.human;
  return html`
    ${k ? html`<div><div class="sec-title">Question</div>${Object.keys(k.input || {}).map((key) => html`<div class="msg"><span class="msg-role label">${key}</span><div class="pre mono">${typeof k.input[key] === 'string' ? k.input[key] : JSON.stringify(k.input[key])}</div></div>`)}
      <div class="msg"><span class="msg-role label">Expected</span><div class="pre mono">${k.expected === null || k.expected === undefined ? 'none declared' : typeof k.expected === 'string' ? k.expected : JSON.stringify(k.expected)}</div></div></div>` : ''}
    <div><div class="sec-title">Response <span class="mark mark-${out.kind}">${out.glyph} ${out.text}</span></div>
      ${o.status === 'error' ? html`<div class="errbox">${(o.error && o.error.type) || 'error'}: ${(o.error && o.error.message) || 'no message'}</div>` : html`<div class="pre mono" tabindex="0" aria-label="Full response text">${o.response && o.response.text ? o.response.text : 'No response text.'}</div>`}
      ${o.response && o.response.finish_reason ? html`<div class="label">Finish reason <span class="mono">${o.response.finish_reason}</span></div>` : ''}
    </div>
    ${arts.length ? html`<div><div class="sec-title">Artifacts</div>${arts.map((a) => html`<div class="msg">${artifactHtml(a, `${cfg.display_name}, ${o.case_id}, repeat ${o.repeat}`, true)}<div class="label"><span class="mono">${a.mime || a.kind}</span>${a.derived ? ' (derived)' : ''}</div></div>`)}</div>` : ''}
    <div><div class="sec-title">Scores</div>
      ${o.scores && o.scores.length ? o.scores.map((s) => html`<div class="score"><strong class="mono">${s.evaluator_id}@${s.evaluator_version}</strong> <span class="label">${s.dimension}</span>
        <div>value <span class="num">${isNum(s.value) ? s.value : NA}</span> · ${s.passed === true ? html`<span class="mark mark-pass">✓ passed</span>` : s.passed === false ? html`<span class="mark mark-fail">✕ failed</span>` : html`<span class="muted">no pass verdict</span>`}</div>
        ${s.details && Object.keys(s.details).length ? html`<div class="pre mono">${json(s.details)}</div>` : ''}</div>`) : html`<div class="muted">No evaluator scores. This observation is ${o.status === 'error' ? 'a failed call' : 'unscored'}.</div>`}
      ${human ? html`<div class="score"><strong>Human rating</strong> <span class="num">${human.value === null ? NA : human.value}</span> of 5 by ${human.reviewer} on <time class="mono">${dateTime(human.created_at)}</time>${human.notes ? html`<div class="pre mono">${human.notes}</div>` : ''}</div>` : ''}
    </div>
    <div><div class="sec-title">Request sent</div>
      ${o.request && o.request.system_prompt ? html`<div class="msg"><span class="msg-role label">system</span><div class="pre mono">${o.request.system_prompt}</div></div>` : ''}
      ${msgs.length ? msgs.map((m) => html`<div class="msg"><span class="msg-role label">${m.role}</span><div class="pre mono">${typeof m.content === 'string' ? m.content : json(m.content)}</div></div>`) : html`<div class="muted">No request messages stored.</div>`}
    </div>`;
}

function kv(rows) {
  return html`<dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
}

function metricsTab(o) {
  const u = o.usage || {};
  return html`<div>${kv([
    ['Quality', isNum(o.quality) ? html`<span class="num">${fixed(o.quality)}</span>` : html`<span class="muted">unscored</span>`],
    ['Passed', o.passed === true ? 'yes' : o.passed === false ? 'no' : html`<span class="muted">unscored</span>`],
    ['Format check', o.format_pass === true ? 'passed' : o.format_pass === false ? 'failed' : html`<span class="muted">not applicable</span>`],
    ['Latency, harness end-to-end', msHtml(o.latency_ms)],
    ['Latency, model request', msHtml(o.model_request_duration_ms)],
    ['Cost, API-equivalent (not billed)', usdHtml(o.cost_usd)],
    ['Input tokens, all prompt tokens', isNum(u.input_tokens) ? html`<span class="num">${u.input_tokens}</span>` : html`<span class="muted">${NA}</span>`],
    ['Cache read tokens', isNum(u.cache_read_tokens) ? html`<span class="num">${u.cache_read_tokens}</span>` : html`<span class="muted">${NA}</span>`],
    ['Cache write tokens', isNum(u.cache_write_tokens) ? html`<span class="num">${u.cache_write_tokens}</span>` : html`<span class="muted">${NA}</span>`],
    ['Output tokens', isNum(u.output_tokens) ? html`<span class="num">${u.output_tokens}</span>` : html`<span class="muted">${NA}</span>`],
    ['Speed', isNum(o.tokens_per_second) ? html`<span class="num">${fixed(o.tokens_per_second, 1)}</span> tok/s` : html`<span class="muted">${NA}</span>`],
    ['Tool calls', isNum(o.tool_calls) ? html`<span class="num">${o.tool_calls}</span>` : html`<span class="muted">${NA}</span>`],
    ['Skills used', o.skills_used && o.skills_used.length ? html`<span class="mono">${o.skills_used.join(', ')}</span>` : html`<span class="muted">none</span>`],
  ])}</div>`;
}

function provenanceTab(o, cfg) {
  const h = cfg.harness || {};
  const meta = o.metadata || {};
  const mono = (v) => (v === null || v === undefined || v === '' ? html`<span class="muted">${NA}</span>` : html`<span class="mono">${v}</span>`);
  return html`<div>${kv([
    ['Run', mono(o.run_id)],
    ['Configuration', mono(o.config_id)],
    ['Model', mono(cfg.model)],
    ['Model key', mono(o.model_key)],
    ['Provider', cfg.provider],
    ['Harness', html`${h.name} <span class="mono">${h.version}</span>`],
    ['Entrypoint', mono(h.entrypoint)],
    ['Access method', cfg.access_method],
    ['Effort', cfg.effort ? mono(cfg.effort) : html`<span class="muted">default</span>`],
    ['Params applied', o.request && o.request.params && Object.keys(o.request.params).length ? html`<span class="mono">${JSON.stringify(o.request.params)}</span>` : html`<span class="muted">none</span>`],
    ['Prompt', html`<span class="mono">${o.request ? o.request.prompt_id : NA} v${o.request ? o.request.prompt_version : NA}</span>`],
    ['Case', mono(o.case_id)],
    ['Repeat', mono(o.repeat)],
    ['Started', html`<time class="mono">${o.started_at || NA}</time>`],
    ['Finished', html`<time class="mono">${o.finished_at || NA}</time>`],
    ['Session id', mono(meta.harness_session_id)],
  ])}</div>
  <details class="detail-box"><summary>Metadata (JSON)</summary><div class="pre mono">${json(meta)}</div></details>`;
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
  const tab = S.insp.tab || 'answer';
  const out = outcome(o);
  const nb = neighbors(o);
  const keep = el.querySelector('.insp-body');
  const scroll = keep && keep.dataset.obs === o.id && keep.dataset.tab === tab ? keep.scrollTop : 0;
  const navBtn = (act, label, target, fk) => html`<button type="button" class="ctl" data-act="insp-go" data-obs="${target ? target.id : ''}" data-fk="${fk}"${target ? '' : raw(' disabled')}>${label}</button>`;
  setHtml(
    el,
    html`<div class="insp-head">
      <div class="insp-title"><h2 id="insp-title" class="row-id">${letterOf(o.config_id) ? html`<span class="lt" aria-hidden="true">${letterOf(o.config_id)}</span>` : ''}<span>${cfg.display_name}</span></h2>
        <div class="insp-sub label">${cfg.harness.name} <span class="mono">${cfg.harness.version}</span> · <span class="mono">${o.case_id}</span> · repeat <span class="mono">r${o.repeat}</span> · <span class="mark mark-${out.kind}">${out.glyph} ${out.text}</span></div></div>
      <button type="button" class="icon-ctl" data-act="insp-close" data-fk="insp:close" aria-label="Close inspector"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" class="ico"/></svg></button>
    </div>
    <div class="tabs" role="tablist" aria-label="Inspector sections">${TABS.map(([id, label]) => html`<button type="button" class="tab" role="tab" id="tab-${id}" data-act="insp-tab" data-tab="${id}" data-fk="insp:tab:${id}" aria-selected="${String(tab === id)}" aria-controls="insp-panel" tabindex="${tab === id ? 0 : -1}">${label}</button>`)}</div>
    <div class="insp-body" id="insp-panel" role="tabpanel" aria-labelledby="tab-${tab}" data-obs="${o.id}" data-tab="${tab}">${tab === 'answer' ? answerTab(o, cfg) : tab === 'metrics' ? metricsTab(o) : provenanceTab(o, cfg)}</div>
    <div class="insp-nav" role="group" aria-label="Move to another observation of this case">
      ${navBtn('go', '‹ Previous repeat', nb.prevRep, 'insp:prev-rep')}${navBtn('go', 'Next repeat ›', nb.nextRep, 'insp:next-rep')}
      ${navBtn('go', '‹ Previous config', nb.prevCfg, 'insp:prev-cfg')}${navBtn('go', 'Next config ›', nb.nextCfg, 'insp:next-cfg')}
    </div>
    <div class="insp-foot">
      <button type="button" class="ctl" data-act="rate" data-obs="${o.id}" data-fk="insp:rate">Rate</button>
      <button type="button" class="ctl" data-act="insp-json" data-obs="${o.id}" data-fk="insp:json">Download JSON</button>
    </div>`,
  );
  const body = el.querySelector('.insp-body');
  if (body && scroll) body.scrollTop = scroll;
  syncOpenChip();
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
  syncOpenChip();
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
  download(`${o.case_id}__${o.config_id}__r${o.repeat}.json`, JSON.stringify(o, null, 2), 'application/json');
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
