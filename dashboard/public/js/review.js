// Rate answers: two answers, A and B, with the setup names hidden and the sides chosen at random.
// The names show after the save. A rating is a human note beside the automatic check, never in place of it.
import { S, obsById, cellObs, cfgOf, caseOf, ctx } from './model.js';
import { caseName } from './words.js';
import { html, setHtml, uuid } from './util.js';
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

// Where "Rate answers" starts: the first case with an answer no check decided, else the first answered case.
export function reviewStartObs() {
  const c = ctx();
  if (!c) return null;
  let first = null;
  for (const caseId of c.cases) {
    for (const id of S.sel) {
      for (const o of cellObs(caseId, id)) {
        if (o.status === 'error') continue;
        if (o.passed === null || o.passed === undefined) return o;
        if (!first) first = o;
      }
    }
  }
  return first;
}

function pickOther(chosen) {
  for (const id of S.sel) {
    if (id === chosen.config_id) continue;
    const list = cellObs(chosen.case_id, id).filter((x) => x.status !== 'error');
    const hit = list.find((x) => x.repeat === chosen.repeat) || list[0];
    if (hit) return hit;
  }
  return null;
}

export const whoText = (o) => {
  const c = cfgOf(o.config_id);
  const setup = c?.setup_state && c.setup_state !== 'loaded' ? ` · user setup ${c.setup_state}` : '';
  return c ? `${c.display_name} · ${c.harness.name} ${c.harness.version}${c.effort ? ` · ${c.effort} effort` : ''}${setup} · try ${o.repeat + 1}` : o.config_id;
};

function sideHtml(o, letter, reveal) {
  const arts = o.status === 'error' ? [] : visualArtifacts(o);
  let body;
  if (o.status === 'error') body = html`<p class="quiet-line">This try gave no answer.</p>`;
  else if (arts.length) body = html`${arts.map((a) => artifactHtml(a, `Answer ${letter}`, true))}`;
  else body = html`<div class="answer-text">${o.response && o.response.text ? o.response.text : 'The answer has no text.'}</div>`;
  return html`<section class="side" aria-labelledby="side-${letter}">
    <div class="side-title"><h3 id="side-${letter}">Answer ${letter}</h3>${reveal ? html`<span class="side-reveal">${whoText(o)}</span>` : ''}</div>
    <div class="side-body">${body}</div>
  </section>`;
}

const inputText = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

function renderReview() {
  const r = S.review;
  const el = dlg();
  if (!r) return;
  const c = ctx();
  const k = caseOf(r.a.case_id);
  const saved = Boolean(r.saved);
  const off = saved ? html` disabled` : '';
  const rating = [1, 2, 3, 4, 5].map((n) => html`<button type="button" class="rate-btn" data-act="rate-value" data-value="${n}" data-fk="review:rate:${n}" aria-pressed="${String(r.value === n)}"${off}>${n}</button>`);
  const pairs = r.b ? [['A', 'A is better'], ['B', 'B is better'], ['tie', 'Same']].map(([v, label]) => html`<button type="button" class="rate-btn" data-act="rate-pair" data-pair="${v}" data-fk="review:pair:${v}" aria-pressed="${String(r.pair === v)}"${off}>${label}</button>`) : '';
  const status = r.error
    ? html`<p class="dlg-status is-error" role="status">${r.error}</p>`
    : saved
      ? html`<p class="dlg-status" role="status">Saved. Answer A was ${whoText(r.a)}${r.b ? `; answer B was ${whoText(r.b)}` : ''}.</p>`
      : html`<p class="dlg-status" role="status">${r.saving ? 'Saving…' : ''}</p>`;
  const name = c ? caseName(r.a.case_id, c.suite.id, k && k.input) : r.a.case_id;
  setHtml(
    el,
    html`<div class="dlg-head">
      <div><h2 id="review-title">Rate answers</h2>
        <p class="dlg-sub">${name}. ${saved ? 'The names now show.' : 'The names stay hidden until you save.'}</p></div>
      <button type="button" class="icon-btn" data-act="review-close" data-fk="review:x" aria-label="Close"><svg class="i" aria-hidden="true"><use href="#i-close"/></svg></button>
    </div>
    <div class="dlg-body">
      ${k ? html`<details class="fold"><summary class="disclose">${k.input && k.input.task ? 'The task' : 'The question'}</summary>${Object.keys(k.input || {}).filter((key) => key !== 'workspace').map((key) => html`<div class="answer-text">${inputText(k.input[key])}</div>`)}
        ${k.expected !== null && k.expected !== undefined && typeof k.expected !== 'object' ? html`<p class="dlg-sub">Expected: ${String(k.expected)}</p>` : ''}</details>` : ''}
      <div class="sides">${sideHtml(r.a, 'A', saved)}${r.b ? sideHtml(r.b, 'B', saved) : ''}</div>
      ${r.b ? '' : html`<p class="dlg-sub">No other shown setup answered this case, so you can rate this answer only.</p>`}
      <div class="rate-group"><p class="rate-h" id="rate-a-h">Rate answer A, from 1 (poor) to 5 (excellent)</p><div class="rate-row" role="group" aria-labelledby="rate-a-h">${rating}</div></div>
      ${r.b ? html`<div class="rate-group"><p class="rate-h" id="rate-pair-h">Which answer is better?</p><div class="rate-row" role="group" aria-labelledby="rate-pair-h">${pairs}</div></div>` : ''}
      <div class="rate-group"><label class="rate-h" for="review-notes">Notes</label><textarea id="review-notes" rows="3"${off}>${r.notes}</textarea></div>
    </div>
    <div class="dlg-foot">
      ${saved
        ? html`<button type="button" class="btn primary" data-act="review-close" data-fk="review:done">Done</button><button type="button" class="btn secondary" data-act="rate-next" data-fk="review:next">Rate another</button>`
        : html`<button type="button" class="btn primary" data-act="review-save" data-fk="review:save"${r.saving ? html` disabled` : ''}>Save rating</button><button type="button" class="btn secondary" data-act="review-close" data-fk="review:cancel">Cancel</button>`}
      ${status}
    </div>`,
  );
}

// openerFk: the control that gets focus back on close. Left out, the earlier opener stays.
export function openReview(obsId, { instant = false, openerFk, saved = () => {} } = {}) {
  const chosen = obsById(obsId);
  if (!chosen) return false;
  const other = pickOther(chosen);
  const flip = other ? coin() : false;
  S.review = { a: flip ? other : chosen, b: other ? (flip ? chosen : other) : null, value: null, pair: null, notes: '', saving: false, error: '', saved: null, pairId: other ? uuid() : null };
  onSaved = saved;
  if (openerFk !== undefined) openerKey = openerFk;
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

// The next try to rate after a save: the next answered try in case order, after the one just rated.
export function nextReviewObs() {
  const c = ctx();
  const r = S.review;
  if (!c || !r) return null;
  const order = [];
  for (const caseId of c.cases) for (const id of S.sel) for (const o of cellObs(caseId, id)) if (o.status !== 'error') order.push(o);
  const rated = new Set([r.a.id, r.b && r.b.id].filter(Boolean));
  const at = Math.max(...order.map((o, i) => (rated.has(o.id) ? i : -1)));
  return order.slice(at + 1).find((o) => o.case_id !== r.a.case_id) || order.find((o) => !rated.has(o.id) && o.case_id !== r.a.case_id) || null;
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
    setReview({ error: 'Choose a rating or the better answer first.' });
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
    setReview({ saving: false, error: `Not saved. Try again. (${error.message})` });
  }
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
  el.addEventListener('keydown', (event) => trapTab(event, el));
  el.addEventListener('click', (event) => {
    if (event.target === el) closeReview();
  });
}
