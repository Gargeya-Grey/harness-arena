// Model Lab dashboard entry. Zero dependencies; reads /api/state, writes only annotations and boards.
import {
  S, VIEWS, setData, contexts, ctx, selectedCfgs, ctxParts, comparison, chooseContext, readHash, writeHash, findContextForBoard,
} from './js/model.js';
import { html, raw, setHtml, esc } from './js/util.js';
import { announce, setStatus, captureFocus, restoreFocus } from './js/ui.js';
import { fetchState, postBoard, deleteBoard } from './js/api.js';
import { renderConfigPanel, renderTray, addCfg, removeCfg, moveCfg, placeCfg } from './js/configs.js';
import { renderLeaderboard, renderTiles, firstDir } from './js/leaderboard.js';
import { renderAnswers } from './js/answers.js';
import { renderCharts, watchChartWidth, downloadChart } from './js/charts.js';
import { renderRuns } from './js/runs.js';
import { renderReviewView, reviewStartObs } from './js/reviewview.js';
import { renderInspector, openInspector, closeInspector, inspectorJson, tabKeys } from './js/inspector.js';
import { openReview, closeReview, setReview, saveReview, wireReview } from './js/review.js';
import { copyMarkdown, exportText, shareCard } from './js/exporter.js';
import { wireSelects } from './js/select.js';

const $ = (id) => document.getElementById(id);

/* ---------- Theme switch (house style) ---------- */
function initTheme() {
  const root = document.documentElement;
  const btn = $('theme-toggle');
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const shown = () => root.getAttribute('data-theme') || (dark.matches ? 'dark' : 'light');
  const paint = () => {
    const next = shown() === 'dark' ? 'light' : 'dark';
    btn.dataset.next = next;
    btn.setAttribute('aria-label', `Switch to ${next} mode`);
    btn.title = `Switch to ${next} mode`;
  };
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
    // Inside the control page's Compare frame, start dark like the page around it.
    else if (window.self !== window.top) root.setAttribute('data-theme', 'dark');
  } catch (e) { /* storage refused: the system setting applies */ }
  btn.addEventListener('click', () => {
    const next = shown() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* not saved */ }
    paint();
    if (S.data) renderCharts();
  });
  if (dark.addEventListener) dark.addEventListener('change', () => { if (!root.getAttribute('data-theme')) { paint(); if (S.data) renderCharts(); } });
  paint();
}

function initNav() {
  // A wrapped app bar is taller than 56px. Keep sticky rails, drawers and
  // answer-grid height in sync rather than letting them slide under its tabs.
  const bar = document.querySelector('.navbar');
  const syncHeight = () => document.documentElement.style.setProperty('--bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  syncHeight();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncHeight).observe(bar);
  else window.addEventListener('resize', syncHeight);
  document.querySelectorAll('.navbar nav a').forEach((a) => {
    a.addEventListener('click', (event) => {
      event.preventDefault();
      setView(a.dataset.view);
    });
  });
}

/* ---------- Views ---------- */
function renderView(view) {
  switch (view) {
    case 'overview': renderTiles(); renderLeaderboard(); renderCharts(); break;
    case 'answers': renderAnswers(); break;
    case 'charts': renderCharts(); break;
    case 'runs': renderRuns(); break;
    case 'review': renderReviewView(); break;
    default: break;
  }
}

function setView(view, { focusTab = false } = {}) {
  const next = VIEWS.includes(view) ? view : 'overview';
  const changed = next !== S.view;
  S.view = next;
  VIEWS.forEach((v) => {
    $('view-' + v).hidden = v !== next;
  });
  document.querySelectorAll('.navbar nav a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.view === next)));
  if (changed && S.insp) closeInspector({ instant: true });
  if (S.data) renderView(next);
  writeHash();
  if (focusTab) $('nav-' + next).focus({ preventScroll: true });
  if (changed) announce(next.charAt(0).toUpperCase() + next.slice(1) + ' view.');
}

/* ---------- Context bar ---------- */
let ctxSig = '';
let boardSig = '';
let extraSig = '';

function renderCtxBar() {
  const sel = $('ctx-select');
  const list = contexts();
  const parts = list.map((c) => ctxParts(c, list));
  const sig = JSON.stringify(list.map((c, i) => [c.key, parts[i]]));
  if (sig !== ctxSig) {
    ctxSig = sig;
    if (!list.length) sel.innerHTML = '<option>No runs yet</option>';
    else sel.innerHTML = list.map((c, i) => `<option value="${esc(c.key)}" data-sub="${esc(parts[i].sub)}">${esc(parts[i].main)}</option>`).join('');
  }
  sel.disabled = !list.length;
  if (S.ctxKey) sel.value = S.ctxKey;

  const cmp = comparison(selectedCfgs());
  const badge = $('ctx-badge');
  badge.innerHTML = String(cmp.text
    ? html`<span class="badge${cmp.mode === 'controlled' ? ' is-controlled' : ''}">${cmp.text}</span><span class="badge-note label">${cmp.note}</span>`
    : html`<span class="badge muted">No selection</span><span class="badge-note label">Add configurations to compare them.</span>`);

  const c = ctx();
  $('ctx-label').textContent = c
    ? `${c.runs.length} run${c.runs.length === 1 ? '' : 's'} · ${c.config_ids.length} configurations${c.latest_run_at ? ` · latest ${String(c.latest_run_at).slice(0, 10)}` : ''}`
    : '';
  const boards = (S.data && S.data.boards) || [];
  const bsel = $('board-select');
  const bsig = JSON.stringify(boards.map((b) => [b.board_id, b.title]));
  if (bsig !== boardSig) {
    boardSig = bsig;
    bsel.innerHTML = `<option value="">${boards.length ? 'Choose a board' : 'No boards saved'}</option>${boards.map((b) => `<option value="${esc(b.board_id)}">${esc(b.title)}</option>`).join('')}`;
  }
  bsel.disabled = !boards.length;
  bsel.value = boards.some((b) => b.board_id === S.boardId) ? S.boardId : '';
  $('board-save').disabled = !ctx() || !S.sel.length;
  $('board-delete').disabled = !S.boardId || !boards.some((b) => b.board_id === S.boardId);
  $('export-btn').disabled = !S.sel.length;
  document.querySelectorAll('#leaderboard [data-act="export"]').forEach((b) => { b.disabled = !S.sel.length; });

  const board = boards.find((b) => b.board_id === S.boardId);
  const esig = `${S.boardForm}|${S.boardConfirm}|${S.boardId}`;
  if (esig !== extraSig) {
    extraSig = esig;
    const extra = $('board-extra');
    if (S.boardForm) {
      const suggestion = board ? board.title : ctx() ? `${ctx().suite.id} · ${S.sel.length} configurations` : '';
      extra.innerHTML = String(html`<form class="board-form" data-form="board-save">
        <input id="board-title" type="text" maxlength="80" required aria-label="Board title" placeholder="Board title" value="${suggestion}" autocomplete="off">
        <button type="submit" class="btn" data-fk="board:save">Save</button>
        <button type="button" class="ctl" data-act="board-cancel" data-fk="board:cancel">Cancel</button>
      </form>`);
    } else if (S.boardConfirm && board) {
      extra.innerHTML = String(html`<div class="board-confirm" role="alertdialog" aria-label="Confirm delete">
        <span>Delete board “${board.title}”? This removes the saved selection only, not any results.</span>
        <button type="button" class="ctl ctl-danger" data-act="board-delete-yes" data-fk="board:delete-yes">Delete board</button>
        <button type="button" class="ctl" data-act="board-delete-no" data-fk="board:delete-no">Keep</button>
      </div>`);
    } else extra.innerHTML = '';
  }
}

/* ---------- Render everything ---------- */
function renderAll(fallbacks = []) {
  const saved = captureFocus();
  renderCtxBar();
  renderConfigPanel();
  renderTray();
  renderView(S.view);
  if (S.insp) renderInspector();
  restoreFocus(saved, fallbacks);
  writeHash();
}

function renderLoadError() {
  const msg = html`<div class="errbox" role="alert"><span>Could not load <span class="mono">GET /api/state</span>: ${S.error}. Nothing is shown because nothing was read.</span><button type="button" class="ctl" data-act="refresh" data-fk="retry">Retry</button></div>`;
  ['cfg-list', 'tray', 'lb', 'ans', 'charts-body', 'charts-all', 'runs-body', 'rev-body'].forEach((id) => setHtml($(id), msg));
  $('ctx-select').innerHTML = '<option>Unavailable</option>';
  $('ctx-select').disabled = true;
  $('ctx-badge').innerHTML = '<span class="badge muted">Unavailable</span>';
}

/* ---------- Data ---------- */
async function loadState({ initial = false } = {}) {
  const btn = $('refresh');
  btn.disabled = true;
  try {
    const data = await fetchState();
    setData(data);
    S.loading = false;
    S.error = null;
    if (initial) {
      const h = readHash();
      chooseContext(h.ctx, h.cfg);
    } else chooseContext(S.ctxKey, S.sel);
    if (S.boardId && !(data.boards || []).some((b) => b.board_id === S.boardId)) S.boardId = '';
    renderAll();
    if (!initial) setStatus(`Refreshed. ${data.runs.length} run${data.runs.length === 1 ? '' : 's'} read.`);
  } catch (error) {
    S.error = error.message;
    S.loading = false;
    if (S.data) setStatus(`Could not refresh. GET /api/state failed: ${error.message}. Select Refresh to retry.`, 'error');
    else renderLoadError();
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Boards ---------- */
function boardView() {
  return { sort: S.sort, only_disagreements: S.only, only_failures: S.fails, repeat: S.rep, latency: S.lat, view: S.view };
}

async function saveBoard(title) {
  const c = ctx();
  if (!c) return;
  const cmp = comparison(selectedCfgs());
  setStatus('Saving board');
  try {
    const board = await postBoard({
      title,
      context: { suite: c.suite.id, prompt: c.prompt.id, cases: c.cases, repeats: c.repeats },
      treatment_axis: cmp.axes.join('+') || 'none',
      configs: S.sel,
      view: boardView(),
    });
    S.boardId = board.board_id;
    S.boardForm = false;
    await refreshQuiet();
    setStatus(`Saved board “${board.title}”.`);
    const btn = $('board-save');
    if (btn) btn.focus({ preventScroll: true });
  } catch (error) {
    setStatus(`Could not save. Try again. (${error.message})`, 'error');
  }
}

async function removeBoard() {
  const id = S.boardId;
  const board = ((S.data && S.data.boards) || []).find((b) => b.board_id === id);
  S.boardConfirm = false;
  try {
    await deleteBoard(id);
    S.boardId = '';
    await refreshQuiet();
    setStatus(`Deleted board “${board ? board.title : id}”.`);
    $('board-select').focus({ preventScroll: true });
  } catch (error) {
    renderCtxBar();
    setStatus(`Could not delete. Try again. (${error.message})`, 'error');
  }
}

async function refreshQuiet() {
  const data = await fetchState();
  setData(data);
  chooseContext(S.ctxKey, S.sel);
  renderAll();
}

function loadBoard(id) {
  const board = ((S.data && S.data.boards) || []).find((b) => b.board_id === id);
  S.boardForm = false;
  S.boardConfirm = false;
  if (!board) {
    S.boardId = '';
    renderAll();
    return;
  }
  const target = findContextForBoard(board);
  if (!target) {
    S.boardId = '';
    renderAll();
    setStatus(`Board “${board.title}” refers to a context that is not in the current data. Run its experiment, then Refresh.`, 'error');
    return;
  }
  const missing = board.configs.filter((c) => !target.config_ids.includes(c));
  chooseContext(target.key, board.configs);
  S.boardId = board.board_id;
  const v = board.view || {};
  if (v.sort && typeof v.sort === 'object') S.sort = { key: v.sort.key || null, dir: v.sort.dir === 'asc' ? 'asc' : 'desc' };
  if (typeof v.only_disagreements === 'boolean') S.only = v.only_disagreements;
  if (typeof v.only_failures === 'boolean') S.fails = v.only_failures;
  if (typeof v.repeat === 'string') S.rep = v.repeat;
  if (v.latency === 'model' || v.latency === 'harness') S.lat = v.latency;
  renderAll();
  setStatus(`Loaded board “${board.title}”.${missing.length ? ` ${missing.length} configuration${missing.length === 1 ? ' is' : 's are'} not in this context and were skipped.` : ''}`, missing.length ? 'error' : '');
}

/* ---------- Selection ---------- */
function afterSelection(message, fallbacks = []) {
  renderAll(fallbacks);
  if (message) announce(message);
}

function selectContext(key, wanted) {
  chooseContext(key, wanted);
  S.boardId = '';
  renderAll();
}

/* ---------- Export menu ---------- */
function setMenu(open, focusFirst = false) {
  const menu = $('export-menu');
  const btn = $('export-btn');
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) {
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
  }
  if (open && focusFirst) menu.querySelector('.export-item').focus();
}

async function doExport(kind, opener) {
  const fromMenu = opener && opener.closest('#export-menu');
  setMenu(false);
  (fromMenu || !opener ? $('export-btn') : opener).focus({ preventScroll: true });
  try {
    if (kind === 'md') {
      const ok = await copyMarkdown();
      setStatus(ok ? 'Copied the Markdown table.' : 'Could not copy. Try again.', ok ? '' : 'error');
    }
    else if (kind === 'png169' || kind === 'png11') {
      setStatus('Drawing the share card');
      await shareCard(kind);
      setStatus(`Downloaded the ${kind === 'png11' ? '1:1' : '16:9'} share card.`);
    } else setStatus(exportText(kind));
  } catch (error) {
    setStatus(`Could not export. Try again. (${error.message})`, 'error');
  }
}

/* ---------- Drag and drop (every drag has a button path) ---------- */
let dragId = null;

function dropIndex(tray, x, y) {
  const chips = [...tray.querySelectorAll('.chip')];
  if (!chips.length) return { index: 0, target: null };
  let best = null;
  let bestD = Infinity;
  chips.forEach((chip, i) => {
    const r = chip.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = Math.hypot(x - cx, (y - cy) * 1.6);
    if (d < bestD) {
      bestD = d;
      best = { i, chip, after: x > cx };
    }
  });
  return { index: best.i + (best.after ? 1 : 0), target: best.chip };
}

function initDrag() {
  document.addEventListener('dragstart', (event) => {
    const item = event.target.closest && event.target.closest('.cfg-row, .chip');
    if (!item) return;
    dragId = item.dataset.cfg;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragId);
    item.classList.add('is-dragging');
  });
  document.addEventListener('dragover', (event) => {
    if (!dragId) return;
    const zone = event.target.closest && event.target.closest('[data-drop="tray"], #tray');
    const panel = event.target.closest && event.target.closest('#cfg-list');
    if (!zone && !(panel && S.sel.includes(dragId))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.chip.is-target').forEach((c) => c.classList.remove('is-target'));
    if (zone) {
      const { target } = dropIndex($('tray'), event.clientX, event.clientY);
      if (target && target.dataset.cfg !== dragId) target.classList.add('is-target');
    }
  });
  document.addEventListener('drop', (event) => {
    if (!dragId) return;
    const zone = event.target.closest && event.target.closest('[data-drop="tray"], #tray');
    const panel = event.target.closest && event.target.closest('#cfg-list');
    const id = dragId;
    if (zone) {
      event.preventDefault();
      const { index } = dropIndex($('tray'), event.clientX, event.clientY);
      const message = placeCfg(id, index);
      afterSelection(message);
    } else if (panel && S.sel.includes(id)) {
      event.preventDefault();
      afterSelection(removeCfg(id));
    }
  });
  document.addEventListener('dragend', () => {
    dragId = null;
    document.querySelectorAll('.is-dragging, .is-target').forEach((el) => el.classList.remove('is-dragging', 'is-target'));
  });
}

/* ---------- Clicks ---------- */
function onAct(act, el, event) {
  const kb = event.detail === 0;
  const id = el.dataset.cfg;
  switch (act) {
    case 'refresh': loadState(); break;
    case 'view': setView(el.dataset.view, { focusTab: kb }); break;
    case 'f-harness': case 'f-provider': {
      const key = act === 'f-harness' ? 'fHarness' : 'fProvider';
      const v = el.dataset.value;
      S[key] = S[key].includes(v) ? S[key].filter((x) => x !== v) : [...S[key], v];
      renderConfigPanel();
      announce((act === 'f-harness' ? 'Harness' : 'Provider') + ' filter: ' + (S[key].join(', ') || 'all') + '.');
      break;
    }
    case 'fails': S.fails = !S.fails; renderAll(); announce(S.fails ? 'Showing only cases with a failure or error.' : 'Showing all cases.'); break;
    case 'run-status': S.runStatus = el.dataset.value; renderAll(); announce('Status filter: ' + S.runStatus + '.'); break;
    case 'review-start': {
      const sel = $('rev-case');
      const obs = sel ? reviewStartObs(sel.value) : null;
      if (!obs) { setStatus('No answer to review for that case.', 'error'); break; }
      S.revCase = sel.value;
      openReview(obs.id, { instant: kb, openerFk: 'review:start', saved: () => { refreshQuiet().then(() => setStatus('Saved the rating.')).catch(() => {}); } });
      break;
    }
    case 'cfg-toggle': S.cfgOpen = !S.cfgOpen; renderConfigPanel(); break;
    case 'cfg-pick': {
      const message = S.sel.includes(id) ? removeCfg(id) : addCfg(id);
      afterSelection(message);
      break;
    }
    case 'tray-left': afterSelection(moveCfg(id, -1), [`tray:${id}:right`, `tray:${id}:remove`]); break;
    case 'tray-right': afterSelection(moveCfg(id, 1), [`tray:${id}:left`, `tray:${id}:remove`]); break;
    case 'tray-remove': {
      const at = S.sel.indexOf(id);
      const message = removeCfg(id);
      const next = S.sel[Math.min(at, S.sel.length - 1)];
      afterSelection(message, next ? [`tray:${next}:remove`] : ['cfg-search']);
      if (!next) $('cfg-search').focus({ preventScroll: true });
      break;
    }
    case 'sort': {
      const key = el.dataset.key;
      const first = firstDir(key);
      if (S.sort.key !== key) S.sort = { key, dir: first };
      else if (S.sort.dir === first) S.sort = { key, dir: first === 'asc' ? 'desc' : 'asc' };
      else S.sort = { key: null, dir: 'desc' };
      renderAll();
      announce(S.sort.key ? `Sorted by ${el.textContent.trim()}, ${S.sort.dir === 'asc' ? 'ascending' : 'descending'}.` : 'Sort cleared. Showing tray order.');
      break;
    }
    case 'only': S.only = !S.only; renderAll(); announce(S.only ? 'Showing only cases where the selected configurations differ.' : 'Showing all cases.'); break;
    case 'rep': S.rep = el.dataset.rep; renderAll(); announce(S.rep === 'all' ? 'Showing all repeats.' : `Showing repeat ${S.rep} only.`); break;
    case 'lat': S.lat = el.dataset.lat; renderAll(); break;
    case 'inspect': openInspector(el.dataset.obs, { instant: kb, openerFk: el.getAttribute('data-fk') }); break;
    case 'insp-close': closeInspector({ instant: kb }); break;
    case 'insp-tab': {
      if (!S.insp) break;
      S.insp.tab = el.dataset.tab;
      renderInspector();
      const again = document.querySelector(`#inspector [role="tab"][data-tab="${el.dataset.tab}"]`);
      if (again) again.focus({ preventScroll: true });
      break;
    }
    case 'insp-go': {
      if (!el.dataset.obs) break;
      const key = el.getAttribute('data-fk');
      openInspector(el.dataset.obs, { instant: true });
      const again = document.querySelector(`[data-fk="${key}"]:not([disabled])`) || document.querySelector('[data-fk="insp:close"]');
      if (again) again.focus({ preventScroll: true });
      break;
    }
    case 'insp-json': inspectorJson(el.dataset.obs); setStatus('Downloaded the observation as JSON.'); break;
    case 'rate': openReview(el.dataset.obs, { instant: kb, openerFk: el.getAttribute('data-fk'), saved: () => { refreshQuiet().then(() => setStatus('Saved the rating.')).catch(() => {}); } }); break;
    case 'rate-value': setReview({ value: S.review && S.review.value === Number(el.dataset.value) ? null : Number(el.dataset.value), error: '' }); break;
    case 'rate-pair': setReview({ pair: S.review && S.review.pair === el.dataset.pair ? null : el.dataset.pair, error: '' }); break;
    case 'review-save': saveReview(); break;
    case 'review-close': closeReview({ instant: kb }); break;
    case 'chart-svg': case 'chart-csv': {
      const ok = downloadChart(el.dataset.chart, act === 'chart-svg' ? 'svg' : 'csv');
      setStatus(ok ? `Downloaded the ${act === 'chart-svg' ? 'SVG' : 'CSV'}.` : 'Could not download. Draw the chart first.', ok ? '' : 'error');
      break;
    }
    case 'open-run': {
      const run = (S.data.runs || []).find((r) => r.run_id === el.dataset.run);
      if (!run) break;
      selectContext(run.context_key, run.config_ids);
      setView('overview');
      window.scrollTo(0, 0);
      setStatus(`Opened the context of run ${run.run_id}.`);
      break;
    }
    case 'board-form': S.boardForm = true; S.boardConfirm = false; renderCtxBar(); { const i = $('board-title'); if (i) { i.focus(); i.select(); } } break;
    case 'board-cancel': S.boardForm = false; renderCtxBar(); $('board-save').focus({ preventScroll: true }); break;
    case 'board-delete': S.boardConfirm = true; S.boardForm = false; renderCtxBar(); { const b = document.querySelector('[data-fk="board:delete-no"]'); if (b) b.focus(); } break;
    case 'board-delete-no': S.boardConfirm = false; renderCtxBar(); $('board-delete').focus({ preventScroll: true }); break;
    case 'board-delete-yes': removeBoard(); break;
    case 'export-menu': setMenu($('export-menu').hidden, kb); break;
    case 'export': doExport(el.dataset.kind, el); break;
    default: break;
  }
}

function initEvents() {
  document.addEventListener('click', (event) => {
    const el = event.target.closest && event.target.closest('[data-act]');
    if (el && !el.disabled) {
      onAct(el.dataset.act, el, event);
      return;
    }
    if (!event.target.closest('#ctx-actions') && !event.target.closest('#export-menu')) setMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!$('export-menu').hidden) {
        setMenu(false);
        $('export-btn').focus();
        return;
      }
      if ($('review').open) return; // the dialog handles its own cancel
      if (S.insp) {
        event.preventDefault();
        closeInspector({ instant: true });
        return;
      }
    }
    if (S.insp && event.target.closest && event.target.closest('#inspector [role="tablist"]')) tabKeys(event);
    const menu = $('export-menu');
    if (!menu.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const items = [...menu.querySelectorAll('.export-item')];
      const i = items.indexOf(document.activeElement);
      event.preventDefault();
      items[(i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  });

  document.addEventListener('change', (event) => {
    const t = event.target;
    if (t.id === 'ctx-select') selectContext(t.value, S.sel);
    else if (t.id === 'board-select') loadBoard(t.value);
    else if (t.id === 'lb-sort-select') {
      S.sort = t.value ? { key: t.value, dir: firstDir(t.value) } : { key: null, dir: 'desc' };
      renderAll();
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest && event.target.closest('[data-form="board-save"]');
    if (!form) return;
    event.preventDefault();
    const title = $('board-title').value.trim();
    if (!title) {
      setStatus('Could not save. Give the board a title.', 'error');
      return;
    }
    saveBoard(title);
  });

  $('cfg-search').addEventListener('input', (event) => {
    S.cfgQuery = event.target.value;
    renderConfigPanel();
  });
}

/* ---------- Boot ---------- */
initTheme();
initNav();
initEvents();
initDrag();
wireReview();
wireSelects();
watchChartWidth();
window.addEventListener('hashchange', () => {
  const h = readHash();
  if (h.view && h.view !== S.view) setView(h.view);
  if (!S.data || !h.ctx) return;
  const same = h.ctx === S.ctxKey && JSON.stringify(h.cfg || []) === JSON.stringify(S.sel);
  if (!same) {
    chooseContext(h.ctx, h.cfg);
    renderAll();
  }
});
{
  const h = readHash();
  setView(h.view || 'overview');
}
loadState({ initial: true });
