// Blind review: answers A and B with names hidden and sides randomised. Names appear after the save.
import { S, obsById, cellObs, cfgOf, caseOf, outcome } from './model.js';
import { html, raw, setHtml, uuid } from './util.js';
import { visualArtifacts, artifactHtml } from './artifacts.js';
import { postAnnotation } from './api.js';
import { trapTab } from './ui.js';

let openerKey = null;
let closeTimer = 0;
let onSaved = () => {};
const dlg = () => document.getElementById('review');

function coin() {
  const a = new Uint8Array(1);
  crypto.getRandomValues(a);
  return (a[0] & 1) === 1;
}

function pickOther(chosen) {
  for (const id of S.sel) {
    if (id === chosen.config_id) continue;
    const list = cellObs(chosen.case_id, id);
    const hit = list.find((x) => x.repeat === chosen.repeat) || list[0];
    if (hit) return hit;
  }
  return null;
}

function sideHtml(o, letter, reveal) {
  const arts = o.status === 'error' ? [] : visualArtifacts(o);
  const cfg = cfgOf(o.config_id);
  let body;
  if (o.status === 'error') body = html`<div class="muted">This call failed, so there is no answer to read.</div>`;
  else if (arts.length) body = html`${arts.map((a) => artifactHtml(a, `Answer ${letter}`, true))}`;
  else body = html`<div class="pre mono">${o.response && o.response.text ? o.response.text : 'No response text.'}</div>`;
  return html`<section class="side" aria-label="Answer ${letter}">
    <div class="side-title"><h3>Answer ${letter}</h3>${reveal ? html`<span class="side-reveal">${cfg ? cfg.display_name : o.config_id} · ${cfg ? cfg.harness.name : ''} <span class="mono">${cfg ? cfg.harness.version : ''}</span> · r${o.repeat}</span>` : ''}</div>
    <div class="side-body">${body}</div>
  </section>`;
}

export function renderReview() {
  const r = S.review;
  const el = dlg();
  if (!r) return;
  const k = caseOf(r.a.case_id);
  const saved = !!r.saved;
  const rating = [1, 2, 3, 4, 5].map((n) => html`<button type="button" class="ctl choice" data-act="rate-value" data-value="${n}" data-fk="review:rate:${n}" aria-pressed="${String(r.value === n)}"${saved ? raw(' disabled') : ''}>${n}</button>`);
  const pairs = r.b ? [['A', 'A better'], ['B', 'B better'], ['tie', 'Tie']].map(([v, label]) => html`<button type="button" class="ctl" data-act="rate-pair" data-pair="${v}" data-fk="review:pair:${v}" aria-pressed="${String(r.pair === v)}"${saved ? raw(' disabled') : ''}>${label}</button>`) : '';
  const nameOf = (c, o) => (c ? `${c.display_name} (${c.harness.name} ${c.harness.version}, ${c.effort || 'default'} effort)` : o.config_id);
  const cfgA = nameOf(cfgOf(r.a.config_id), r.a);
  const cfgB = r.b ? nameOf(cfgOf(r.b.config_id), r.b) : null;
  const status = r.error
    ? html`<span class="dlg-status label is-error" role="status">${r.error}</span>`
    : saved
      ? html`<span class="dlg-status label" role="status">Saved. Answer A was ${cfgA}${cfgB ? html`; answer B was ${cfgB}` : ''}.</span>`
      : html`<span class="dlg-status label" role="status">${r.saving ? 'Saving' : ''}</span>`;
  setHtml(
    el,
    html`<div class="dlg-head">
      <div><h2 id="review-title">Blind review</h2>
        <div class="label">Case <span class="mono">${r.a.case_id}</span>. ${saved ? 'Names are now shown.' : 'Names are hidden until you save.'}</div></div>
      <button type="button" class="icon-ctl" data-act="review-close" data-fk="review:x" aria-label="Close review">×</button>
    </div>
    <div class="dlg-body">
      ${k ? html`<div><div class="sec-title">Brief</div>${Object.keys(k.input || {}).map((key) => html`<div class="msg"><span class="msg-role label">${key}</span><div class="pre mono">${typeof k.input[key] === 'string' ? k.input[key] : JSON.stringify(k.input[key])}</div></div>`)}
        <details class="detail-box"><summary>Expected answer</summary><div class="pre mono">${k.expected === null || k.expected === undefined ? 'none declared' : typeof k.expected === 'string' ? k.expected : JSON.stringify(k.expected)}</div></details></div>` : ''}
      <div class="sides">${sideHtml(r.a, 'A', saved)}${r.b ? sideHtml(r.b, 'B', saved) : ''}</div>
      ${r.b ? '' : html`<div class="label">No other selected configuration has an answer for this case, so only a rating is possible.</div>`}
      <div class="rate-group"><div class="sec-title">Rate answer A, from 1 (poor) to 5 (excellent)</div><div class="rate-row" role="group" aria-label="Rating for answer A">${rating}</div></div>
      ${r.b ? html`<div class="rate-group"><div class="sec-title">Which answer is better?</div><div class="rate-row" role="group" aria-label="Pairwise choice">${pairs}</div></div>` : ''}
      <div class="rate-group"><label class="sec-title" for="review-notes">Notes</label><textarea id="review-notes" rows="3" ${saved ? raw('disabled') : ''}>${r.notes}</textarea></div>
    </div>
    <div class="dlg-foot">
      ${saved ? html`<button type="button" class="btn primary" data-act="review-close" data-fk="review:done">Done</button>` : html`<button type="button" class="btn primary" data-act="review-save" data-fk="review:save"${r.saving ? raw(' disabled') : ''}>Save rating</button><button type="button" class="ctl" data-act="review-close" data-fk="review:cancel">Cancel</button>`}
      ${status}
    </div>`,
  );
}

export function openReview(obsId, { instant = false, openerFk = null, saved = () => {} } = {}) {
  const chosen = obsById(obsId);
  if (!chosen) return false;
  const other = pickOther(chosen);
  const flip = other ? coin() : false;
  S.review = { a: flip ? other : chosen, b: other ? (flip ? chosen : other) : null, value: null, pair: null, notes: '', saving: false, error: '', saved: null, pairId: other ? uuid() : null };
  onSaved = saved;
  openerKey = openerFk;
  clearTimeout(closeTimer);
  renderReview();
  const el = dlg();
  el.toggleAttribute('data-instant', instant);
  el.classList.remove('is-in');
  if (!el.open) el.showModal();
  void el.offsetWidth;
  el.classList.add('is-in');
  const first = el.querySelector('[data-fk="review:rate:3"]') || el.querySelector('button');
  if (first) first.focus({ preventScroll: true });
  return true;
}

export function closeReview({ instant = false } = {}) {
  const el = dlg();
  if (!el.open) return;
  const key = openerKey;
  openerKey = null;
  S.review = null;
  el.toggleAttribute('data-instant', instant);
  el.classList.remove('is-in');
  const finish = () => {
    if (el.open) el.close();
    el.innerHTML = '';
    if (key) {
      const target = document.querySelector(`[data-fk="${CSS.escape(key)}"]`);
      if (target) target.focus({ preventScroll: true });
    }
  };
  clearTimeout(closeTimer);
  if (instant) finish();
  else closeTimer = setTimeout(finish, 160);
}

export function setReview(patch, keepFocus = true) {
  if (!S.review) return;
  Object.assign(S.review, patch);
  const active = document.activeElement && document.activeElement.closest('[data-fk]');
  const key = active ? active.getAttribute('data-fk') : null;
  renderReview();
  if (keepFocus && key) {
    const again = dlg().querySelector(`[data-fk="${CSS.escape(key)}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
    else {
      const fallback = dlg().querySelector('[data-fk="review:done"], [data-fk="review:save"]');
      if (fallback) fallback.focus({ preventScroll: true });
    }
  }
}

export async function saveReview() {
  const r = S.review;
  if (!r || r.saving || r.saved) return;
  if (r.value === null && r.pair === null) {
    setReview({ error: 'Choose a rating or a pairwise answer first.' });
    return;
  }
  setReview({ saving: true, error: '' });
  try {
    const record = await postAnnotation({
      run_id: r.a.run_id,
      case_id: r.a.case_id,
      config_id: r.a.config_id,
      repeat: r.a.repeat,
      value: r.value,
      notes: r.notes,
      pair_id: r.b ? r.pairId : null,
      pair_choice: r.b ? r.pair : null,
      pair_config_id: r.b ? r.b.config_id : null,
      reviewer: 'owner',
    });
    setReview({ saving: false, saved: record, error: '' });
    onSaved(record);
  } catch (error) {
    setReview({ saving: false, error: `Could not save. Try again. (${error.message})` });
  }
}

export function reviewKeydown(event) {
  trapTab(event, dlg());
}

export function wireReview() {
  const el = dlg();
  el.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeReview({ instant: true });
  });
  el.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'review-notes' && S.review) S.review.notes = event.target.value;
  });
  el.addEventListener('keydown', reviewKeydown);
  el.addEventListener('click', (event) => {
    if (event.target === el) closeReview();
  });
}
