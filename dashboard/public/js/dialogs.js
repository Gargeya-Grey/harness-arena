// The Results page dialogs: Change test, Choose setups, Save view; and the Share menu.
// Each dialog is a <dialog> in results.html; this file fills it and opens or closes it.
import { S, ctx, contexts, setupsOf, defaultSel, MAX_SHOWN, findContextForBoard } from './model.js';
import { rankSetups, passedText } from './verdict.js';
import { verdictFor, caseLabel } from './summary.js';
import { groupTests, testMeta, testTitle, shortDate, durText, plural } from './words.js';
import { harnessLine } from './setups.js';
import { html, raw, setHtml, keepParts } from './util.js';
import { trapTab } from './ui.js';

const $ = (id) => document.getElementById(id);
const openers = new Map();

export function openDlg(id, focusSel = null) {
  const el = $(id);
  if (!el) return;
  const active = document.activeElement && document.activeElement.closest('[data-fk]');
  openers.set(id, active ? active.getAttribute('data-fk') : null);
  el.classList.remove('is-in');
  if (!el.open) el.showModal();
  void el.offsetWidth;
  el.classList.add('is-in');
  const first = (focusSel && el.querySelector(focusSel)) || el.querySelector('[aria-current="true"], input, .dlg-body button, button');
  if (first) first.focus({ preventScroll: true });
}

export function closeDlg(id) {
  const el = $(id);
  if (!el || !el.open) return;
  el.classList.remove('is-in');
  el.close();
  const key = openers.get(id);
  openers.delete(id);
  const back = key && document.querySelector(`[data-fk="${CSS.escape(key)}"]`);
  if (back && back.offsetParent !== null) back.focus({ preventScroll: true });
}

export function wireDialogs(ids) {
  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDlg(id);
    });
    el.addEventListener('keydown', (event) => trapTab(event, el));
    // A click on the backdrop lands on the dialog element itself.
    el.addEventListener('click', (event) => {
      if (event.target === el) closeDlg(id);
    });
  });
}

/* ---------- Change test ---------- */
const boards = () => (S.data && S.data.boards) || [];

function testEntry(c, showVersion) {
  const v = verdictFor(c);
  const on = c.key === S.ctxKey && !S.boardId;
  const meta = testMeta(c, c.config_ids.length, caseLabel(c));
  return html`<li><button type="button" class="pick" data-act="pick-test" data-ctx="${c.key}" data-fk="pick:${c.key}"${on ? html` aria-current="true"` : ''}>
    <span class="pick-main">${showVersion ? html`<span class="pick-ver">Version ${c.suite.version}</span><span class="sr">, </span>` : ''}${raw(keepParts(meta))}</span>
    <span class="pick-say">${v.sentences[0] || ''}</span>
  </button></li>`;
}

export function renderTestPicker({ armed = '' } = {}) {
  const host = $('pick-test-body');
  if (!host) return;
  const saved = boards().map((b) => ({ b, c: findContextForBoard(b) }));
  const groups = groupTests(contexts());
  const views = saved.length
    ? html`<section class="pick-group" aria-labelledby="pick-views-h">
        <h3 class="pick-h" id="pick-views-h">Saved views</h3>
        <ul class="pick-list">${saved.map(({ b, c }) => {
          const on = S.boardId === b.board_id;
          const sure = armed === b.board_id;
          return html`<li class="pick-row">
            <button type="button" class="pick" data-act="open-board" data-board="${b.board_id}" data-fk="board:${b.board_id}"${on ? html` aria-current="true"` : ''}${c ? '' : html` disabled`}>
              <span class="pick-main">${b.title}</span>
              <span class="pick-say">${c ? `${testTitle(c)} · ${plural(b.configs.length, 'setup')} · saved ${shortDate(b.updated_at || b.created_at)}` : 'Its test has no stored runs now.'}</span>
            </button>
            <button type="button" class="btn ${sure ? 'danger' : 'quiet'} small" data-act="remove-board" data-board="${b.board_id}" data-fk="board-x:${b.board_id}" aria-label="${sure ? `Confirm: remove the saved view ${b.title}` : `Remove the saved view ${b.title}`}">${sure ? 'Confirm remove' : 'Remove'}</button>
          </li>`;
        })}</ul>
        ${armed ? html`<p class="pick-note" role="alert">Removing a view deletes the saved choice only. Every run stays.</p>` : ''}
      </section>`
    : '';
  const tests = groups.map((g) => {
    const versions = new Set([...g.current, ...g.earlier].map((c) => c.suite.version)).size > 1;
    return html`<section class="pick-group" aria-labelledby="pick-h-${g.suite}">
      <h3 class="pick-h" id="pick-h-${g.suite}">${g.title}</h3>
      <ul class="pick-list">${g.current.map((c) => testEntry(c, versions))}</ul>
      ${g.earlier.length ? html`<details class="pick-earlier"${g.earlier.some((c) => c.key === S.ctxKey) ? html` open` : ''}>
        <summary class="disclose">Earlier versions <span class="count">${g.earlier.length}</span></summary>
        <ul class="pick-list">${g.earlier.map((c) => testEntry(c, true))}</ul>
      </details>` : ''}
    </section>`;
  });
  setHtml(host, html`${views}${tests}`);
}

/* ---------- Choose setups ---------- */
// chosen: the ids ticked in the dialog, not yet shown.
export function renderSetupPicker(chosen) {
  const host = $('pick-setups-body');
  const count = $('pick-setups-count');
  const c = ctx();
  if (!host || !c) return;
  const list = rankSetups(setupsOf(c.config_ids, c));
  const full = chosen.size >= MAX_SHOWN;
  setHtml(
    host,
    html`<fieldset class="choose">
      <legend class="sr">Setups to show</legend>
      ${list.map((s) => {
        const on = chosen.has(s.id);
        const f = s.facts;
        const facts = [f.decided ? `passed ${passedText(f)}` : f.incomplete ? 'unfinished execution' : f.unchecked ? 'not checked' : 'no answers', f.time !== null ? `${durText(f.time)} typical` : null, f.errors > f.incomplete ? `${f.errors - f.incomplete} without answer` : null, f.incomplete ? `${f.incomplete} unfinished, unjudged` : null].filter(Boolean).join(' · ');
        return html`<label class="choose-row${on ? ' is-on' : ''}${!on && full ? ' is-off' : ''}">
          <input type="checkbox" data-act="choose-tick" value="${s.id}" data-fk="tick:${s.id}"${on ? html` checked` : ''}${!on && full ? html` disabled` : ''}>
          <span class="choose-text"><span class="choose-name">${s.cfg.display_name}</span><span class="choose-sub">${harnessLine(s.cfg)}</span></span>
          <span class="choose-facts">${facts}</span>
        </label>`;
      })}
    </fieldset>`,
  );
  if (count) count.textContent = `${chosen.size} of ${list.length} chosen${full ? `. ${MAX_SHOWN} is the most at once.` : ''}`;
  const apply = $('choose-apply');
  if (apply) apply.disabled = chosen.size === 0;
}

// The ids in table order: best first, as the table sorts them.
export function orderChosen(chosen) {
  const c = ctx();
  return rankSetups(setupsOf(c.config_ids, c)).map((s) => s.id).filter((id) => chosen.has(id));
}
export const isDefault = (ids) => {
  const c = ctx();
  const d = c ? defaultSel(c) : [];
  return ids.length === d.length && ids.every((id, i) => id === d[i]);
};

/* ---------- Save view ---------- */
export function renderSaveView() {
  const c = ctx();
  const input = $('view-title');
  const note = $('view-note');
  if (!c || !input) return;
  const board = boards().find((b) => b.board_id === S.boardId);
  input.value = board ? board.title : `${testTitle(c)}: ${plural(S.sel.length, 'setup')}`;
  if (note) note.textContent = `Saves this test and the ${plural(S.sel.length, 'setup')} shown. Results are not copied: the view always shows the stored runs.`;
  const status = $('view-status');
  if (status) status.textContent = '';
}

/* ---------- Share menu ---------- */
export function shareOpen() {
  const pop = $('share-pop');
  return Boolean(pop && !pop.hidden);
}
export function toggleShare(open = !shareOpen()) {
  const pop = $('share-pop');
  const btn = $('share-btn');
  if (!pop || !btn) return;
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) {
    const first = pop.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
}
