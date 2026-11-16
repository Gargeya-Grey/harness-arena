// The Results page dialogs: Change test, Choose setups, Save view; and the Share menu.
// Each dialog is a <dialog> in results.html; this file fills it and opens or closes it.
import { S, ctx, contexts, setupsOf, defaultSel, MAX_SHOWN, findContextForBoard } from './model.js';
import { rankSetups, passedText } from './verdict.js';
import { verdictFor, caseLabel } from './summary.js';
import { groupTests, testMeta, testTitle, shortDate, durText, plural } from './words.js';
import { harnessLine } from './setups.js';
import { effortValue, effortText, setupTags } from './setup-tags.js';
import { html, raw, setHtml, keepParts } from './util.js';
import { trapTab, captureDisclosures, restoreDisclosures } from './ui.js';

const $ = (id) => document.getElementById(id);
const openers = new Map();
const testDisclosures = new Map();

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
  if (!el || !el.open || el.dataset.busy === 'true') return;
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
    <span class="pick-exact">${contextIdentity(c)}</span>
  </button></li>`;
}

const contextIdentity = (c) => `${c.suite.id}@${c.suite.version} · ${c.prompt.id}@${c.prompt.version} · ${(c.evaluators || []).map((e) => `${e.id}@${e.version}`).join(', ') || 'no automatic checks'}`;
const matches = (query, values) => !query || values.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
const setupMatches = (s, query) => matches(query, [s.name, s.id, s.cfg.model_key, s.cfg.model, harnessLine(s.cfg)]);
const configSearchValues = (ids) => ids.flatMap((id) => {
  const config = S.data?.configs?.[id];
  return config ? [id, config.display_name, config.model_key, config.model, config.harness?.name, config.harness?.version, config.effort, config.user_config, config.setup_state] : [id];
});
const testSearchValues = (c) => [testTitle(c), contextIdentity(c), c.key, ...configSearchValues(c.config_ids)];

export function renderTestPicker({ armed = '' } = {}) {
  const host = $('pick-test-body');
  if (!host) return;
  for (const [id, open] of captureDisclosures(host)) testDisclosures.set(id, open);
  const query = S.testQuery.trim();
  const input = $('test-search');
  if (input && input.value !== S.testQuery) input.value = S.testQuery;
  const saved = boards().map((b) => ({ b, c: findContextForBoard(b) })).filter(({ b, c }) => matches(query, [b.title, b.board_id, b.context.suite, b.context.prompt, c ? contextIdentity(c) : 'unavailable no stored runs', ...configSearchValues(b.configs)]));
  const groups = groupTests(contexts()).map((g) => ({ ...g, current: g.current.filter((c) => matches(query, testSearchValues(c))), earlier: g.earlier.filter((c) => matches(query, testSearchValues(c))) })).filter((g) => g.current.length + g.earlier.length);
  const found = groups.reduce((n, g) => n + g.current.length + g.earlier.length, 0);
  const note = $('test-matches');
  if (note) note.textContent = `${found} of ${plural(contexts().length, 'test')} · ${saved.length} of ${plural(boards().length, 'saved view')} match.`;
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
            ${!c ? html`<p class="pick-unavailable">Unavailable: its test has no stored runs now.</p>` : ''}
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
      ${g.earlier.length && query ? html`<ul class="pick-list">${g.earlier.map((c) => testEntry(c, true))}</ul>` : g.earlier.length ? html`<details class="pick-earlier" id="test-earlier-${g.suite}"${g.earlier.some((c) => c.key === S.ctxKey) ? html` open` : ''}>
        <summary class="disclose">Earlier versions <span class="count">${g.earlier.length}</span></summary>
        <ul class="pick-list">${g.earlier.map((c) => testEntry(c, true))}</ul>
      </details>` : ''}
    </section>`;
  });
  setHtml(host, html`${views}${tests}${!saved.length && !found ? html`<p class="quiet-line">No tests or saved views match. Clear search to see all stored tests.</p>` : ''}`);
  restoreDisclosures(testDisclosures, host);
}

/* ---------- Choose setups ---------- */
// chosen: the ids ticked in the dialog, not yet shown.
export function renderSetupPicker(chosen) {
  const host = $('pick-setups-body');
  const count = $('pick-setups-count');
  const c = ctx();
  if (!host || !c) return;
  const list = rankSetups(setupsOf(c.config_ids, c));
  const shown = list.filter((s) => setupMatches(s, S.setupQuery) && (!S.setupHarness || s.cfg.harness?.name === S.setupHarness) && (!S.setupEffort || effortValue(s.cfg) === S.setupEffort));
  const outside = list.filter((s) => chosen.has(s.id) && !shown.includes(s)).length;
  const input = $('setup-search');
  if (input && input.value !== S.setupQuery) input.value = S.setupQuery;
  const filters = $('setup-filters');
  if (filters) {
    const harnesses = [...new Set(list.map((s) => s.cfg.harness?.name).filter(Boolean))].sort();
    const efforts = [...new Set(list.map((s) => effortValue(s.cfg)))].sort();
    const key = JSON.stringify([c.key, harnesses, efforts, S.setupHarness && !harnesses.includes(S.setupHarness) ? S.setupHarness : '', S.setupEffort && !efforts.includes(S.setupEffort) ? S.setupEffort : '']);
    const options = (values, current, label = (value) => value) => html`${values.map((value) => html`<option value="${value}"${value === current ? html` selected` : ''}>${label(value)}</option>`)}${current && !values.includes(current) ? html`<option value="${current}" selected disabled>${label(current)} (no longer present)</option>` : ''}`;
    if (filters.dataset.options !== key) {
      setHtml(filters, html`<label for="setup-harness">Harness<select id="setup-harness" name="harness" data-fk="setup-harness"><button><selectedcontent></selectedcontent></button><option value="">All harnesses</option>${options(harnesses, S.setupHarness)}</select></label><label for="setup-effort">Thinking effort<select id="setup-effort" name="effort" data-fk="setup-effort"><button><selectedcontent></selectedcontent></button><option value="">All efforts</option>${options(efforts, S.setupEffort, effortText)}</select></label><button type="button" class="btn quiet small" data-act="setup-filters-clear" data-fk="setup-filters-clear">Clear filters</button>`);
      filters.dataset.options = key;
    }
    $('setup-harness').value = S.setupHarness;
    $('setup-effort').value = S.setupEffort;
  }
  const full = chosen.size >= MAX_SHOWN;
  setHtml(
    host,
    html`<fieldset class="choose">
      <legend class="sr">Setups to show</legend>
      ${shown.map((s) => {
        const on = chosen.has(s.id);
        const f = s.facts;
        const facts = [f.decided ? `passed ${passedText(f)}` : f.incomplete ? 'unfinished execution' : f.unchecked ? 'not checked' : 'no answers', f.time !== null ? `${durText(f.time)} typical` : null, f.errors > f.incomplete ? `${f.errors - f.incomplete} without answer` : null, f.incomplete ? `${f.incomplete} unfinished, unjudged` : null].filter(Boolean).join(' · ');
        return html`<label class="choose-row${on ? ' is-on' : ''}${!on && full ? ' is-off' : ''}">
          <input type="checkbox" data-act="choose-tick" value="${s.id}" data-fk="tick:${s.id}"${on ? html` checked` : ''}${!on && full ? html` disabled` : ''}>
          <span class="choose-text"><span class="choose-name">${s.cfg.display_name}</span>${setupTags(s.cfg)}<span class="choose-sub">User setup ${s.cfg.setup_state || s.cfg.user_config || 'not recorded'}</span></span>
          <span class="choose-facts">${facts}</span>
        </label>`;
      })}
    </fieldset>${!shown.length ? html`<p class="quiet-line">No setups match. Clear filters to see every setup. Your selection is kept.</p>` : ''}`,
  );
  if (count) count.textContent = `${chosen.size} of ${list.length} selected · ${shown.length} match · ${outside} selected outside matches${full ? `. ${MAX_SHOWN} is the most at once.` : ''}`;
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
