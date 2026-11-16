// Results page entry. Reads /api/state, shows one test: the answer, the setups, case by case,
// graphs, retained output, ratings and run history.
import { mountShell, watchJobs, progressText } from './shell.js';
import { jobTitle } from './js/jobwatch.js';
import { S, setData, ctx, readHash, writeHash, chooseContext, defaultSel, onlyOn, findContextForBoard, selectedCfgs, comparison, obsById } from './js/model.js';
import { fetchState, postBoard, deleteBoard, postJob } from './js/api.js';
import { renderHead, renderAnswer } from './js/summary.js';
import { renderSetups } from './js/setups.js';
import { renderCases } from './js/cases.js';
import { renderCharts, watchChartWidth } from './js/charts.js';
import { renderRuns, renderDeleteRun, deleteStoredRun } from './js/runs.js';
import { renderRatings } from './js/ratings.js';
import { renderInspector, openInspector, closeInspector, inspectorJson, tabKeys, renderVisualOutputs } from './js/inspector.js';
import { openReview, closeReview, setReview, saveReview, wireReview, reviewStartObs, nextReviewObs } from './js/review.js';
import { openDlg, closeDlg, wireDialogs, renderTestPicker, renderSetupPicker, orderChosen, isDefault, renderSaveView, toggleShare, shareOpen } from './js/dialogs.js';
import { markdown, saveFile, picture } from './js/exporter.js';
import { testTitle } from './js/words.js';
import { setStatus, announce, captureFocus, restoreFocus, captureDisclosures, restoreDisclosures } from './js/ui.js';
import { copyText, html, setHtml } from './js/util.js';

const $ = (id) => document.getElementById(id);
const SECTIONS = ['setups-sect', 'visuals-sect', 'cases-sect', 'runs-sect'];
const DESTINATIONS = { overview: 'answer', setups: 'setups-sect', graphs: 'charts-sect', visuals: 'visuals-sect', cases: 'cases-sect', runs: 'runs-sect' };

let chosen = new Set();
let armedRun = '';
let armedBoard = '';
let armTimer = 0;
let running = null; // the job that runs now, from the job watch
let watcher = null;
let renderedContext = null;
let deletingRun = '';
const disclosures = new Map();

/* ---------- Render ---------- */
function renderEmpty() {
  const empty = $('empty');
  if (S.error && !S.data) {
    setHtml(empty, html`<h2>The results did not load</h2><p>${S.error}. Check that <code>node lab dashboard</code> still runs, then try again.</p><button type="button" class="btn primary" data-act="reload" data-fk="reload">Try again</button>`);
  } else {
    const removed = Boolean(S.ctxKey);
    setHtml(empty, html`<h2>${removed ? 'This test has no stored runs now' : 'No results yet'}</h2><p>${removed ? 'Its results were removed. Choose another stored test or make a new run to see results here.' : 'Choose a test on Run, preview its plan, then start it. Results will show the setups, graphs and every retained answer.'}</p><div class="empty-actions">${S.data?.contexts?.length ? html`<button type="button" class="btn secondary" data-act="change-test" data-fk="empty:choose">Choose tests</button>` : ''}<a class="btn primary" href="/#run" data-fk="empty:run">Choose tests to run</a></div>`);
  }
}

function moveToSection(section, { focus = true } = {}) {
  if (!ctx() || !DESTINATIONS[section]) return;
  S.section = section;
  if (section === 'runs') $('runs-details').open = true;
  document.querySelectorAll('#result-nav [data-section]').forEach((button) => {
    if (button.dataset.section === section) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
  });
  writeHash();
  const target = $(DESTINATIONS[section]);
  const heading = target.querySelector('h2') || $('test-title');
  if (focus) heading.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
}

function renderRunsNow() {
  const saved = captureFocus();
  const folds = captureDisclosures($('runs'));
  renderRuns({ armed: armedRun, busy: Boolean(running) });
  restoreDisclosures(folds, $('runs'));
  restoreFocus(saved);
}

function renderAll() {
  const saved = captureFocus();
  if (renderedContext) disclosures.set(renderedContext, captureDisclosures($('main')));
  const c = ctx();
  renderHead();
  $('test-acts').hidden = !c;
  $('test-context').hidden = !c;
  $('answer').hidden = !c;
  $('empty').hidden = Boolean(c);
  $('result-nav').hidden = !c;
  $('results-guide').hidden = !c;
  document.querySelectorAll('#result-nav [data-section]').forEach((button) => {
    if (button.dataset.section === S.section) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
  });
  SECTIONS.forEach((id) => { $(id).hidden = !c; });
  if (!c) {
    $('charts-sect').hidden = true;
    $('ratings-sect').hidden = true;
    closeInspector({ instant: true });
    for (const id of ['answer', 'setups', 'charts-main', 'charts-more-body', 'cases', 'visuals', 'runs', 'ratings']) $(id).innerHTML = '';
    renderEmpty();
    if (S.data) $('test-meta').textContent = '';
    return;
  }
  renderAnswer();
  renderSetups();
  renderCases();
  renderCharts();
  renderVisualOutputs();
  renderRatings();
  renderRunsNow();
  restoreDisclosures(disclosures.get(c.key), $('main'));
  renderedContext = c.key;
  if (S.insp) renderInspector();
  writeHash();
  restoreFocus(saved, ['change-test']);
}

/* ---------- Data ---------- */
async function load({ initial = false } = {}) {
  try {
    const data = await fetchState();
    setData(data);
    S.error = null;
    if (initial) {
      const h = readHash();
      chooseContext(h.ctx, h.cfg, { fallback: !h.ctx });
      S.only = h.only;
      S.caseQuery = h.query || '';
      S.caseOutcomes = h.outcomes || [];
      S.section = h.section || 'overview';
    } else {
      chooseContext(S.ctxKey, S.custom ? S.sel : null, { fallback: !S.ctxKey });
    }
    if (S.boardId && !(data.boards || []).some((b) => b.board_id === S.boardId)) S.boardId = '';
    renderAll();
    if ($('pick-setups').open && ctx()) {
      const valid = new Set(ctx().config_ids);
      chosen = new Set([...chosen].filter((id) => valid.has(id)));
      renderSetupPicker(chosen);
    }
    if (initial && S.section !== 'overview') requestAnimationFrame(() => moveToSection(S.section, { focus: false }));
    return true;
  } catch (error) {
    S.error = error.message;
    if (S.data) setStatus(`The results did not refresh: ${error.message}.`, 'error');
    else renderAll();
    return false;
  }
}

/* ---------- Test and setups ---------- */
function showTest(key, { cfg = null, only = null, board = '', query = '', outcomes = [], section = 'overview' } = {}) {
  closeInspector({ instant: true });
  S.boardId = board;
  S.details = false;
  chooseContext(key, cfg);
  S.only = only;
  S.caseQuery = query;
  S.caseOutcomes = outcomes;
  S.section = section;
  renderAll();
  window.scrollTo({ top: 0 });
  if (section !== 'overview') requestAnimationFrame(() => moveToSection(section, { focus: false }));
  const c = ctx();
  if (c) announce(`Showing ${testTitle(c)}.`);
}

function openBoard(id) {
  const board = ((S.data && S.data.boards) || []).find((b) => b.board_id === id);
  const c = board && findContextForBoard(board);
  if (!c) return;
  closeDlg('pick-test');
  const only = board.view && typeof board.view.only === 'boolean' ? board.view.only : null;
  showTest(c.key, { cfg: board.configs, only, board: board.board_id });
  setStatus(`Opened the saved view “${board.title}”.`);
}

async function removeBoard(id) {
  const board = ((S.data && S.data.boards) || []).find((b) => b.board_id === id);
  if (armedBoard !== id) {
    armedBoard = id;
    renderTestPicker({ armed: id });
    const again = document.querySelector(`[data-fk="board-x:${CSS.escape(id)}"]`);
    if (again) again.focus({ preventScroll: true });
    return;
  }
  armedBoard = '';
  try {
    await deleteBoard(id);
    if (S.boardId === id) S.boardId = '';
    await load();
    renderTestPicker();
    const first = $('pick-test-body').querySelector('button');
    if (first) first.focus({ preventScroll: true });
    setStatus(`Removed the saved view “${board ? board.title : id}”. The runs stay.`);
  } catch (error) {
    renderTestPicker();
    setStatus(`The view was not removed: ${error.message}.`, 'error');
  }
}

function openChooser() {
  chosen = new Set(S.sel);
  S.setupQuery = '';
  S.setupHarness = '';
  S.setupEffort = '';
  renderSetupPicker(chosen);
  openDlg('pick-setups', 'input:checked, input');
}

function applyChosen(ids) {
  S.sel = ids;
  S.custom = !isDefault(ids);
  closeDlg('pick-setups');
  const open = S.insp && obsById(S.insp.obsId);
  if (S.insp && (!open || !ids.includes(open.config_id))) closeInspector({ instant: true });
  renderAll();
  announce(`Showing ${ids.length} setups.`);
}

async function saveView(event) {
  event.preventDefault();
  const c = ctx();
  const input = $('view-title');
  const title = input.value.trim();
  const status = $('view-status');
  if (!title) {
    status.textContent = 'Give the view a name.';
    status.classList.add('is-error');
    input.focus();
    return;
  }
  status.classList.remove('is-error');
  status.textContent = 'Saving…';
  const current = ((S.data && S.data.boards) || []).find((b) => b.board_id === S.boardId);
  try {
    const board = await postBoard({
      board_id: current && current.title === title ? current.board_id : undefined,
      title,
      context: { suite: c.suite.id, prompt: c.prompt.id, cases: c.cases, repeats: c.repeats },
      treatment_axis: comparison(selectedCfgs()).axes.join('+') || 'none',
      configs: S.sel,
      view: { only: S.only },
    });
    S.boardId = board.board_id;
    S.custom = true;
    closeDlg('save-view');
    await load();
    setStatus(`Saved the view “${board.title}”. Find it under Change test.`);
  } catch (error) {
    status.classList.add('is-error');
    status.textContent = `Not saved: ${error.message}.`;
  }
}

/* ---------- Jobs ---------- */
async function removeRun(id) {
  if (deletingRun) return;
  const status = $('delete-run-status');
  const dialog = $('delete-run');
  deletingRun = id;
  dialog.dataset.busy = 'true';
  dialog.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  status.classList.remove('is-error');
  status.textContent = 'Deleting this run…';
  try {
    const result = await deleteStoredRun(id);
    delete dialog.dataset.busy;
    closeDlg('delete-run');
    closeInspector({ instant: true });
    setData(null);
    renderAll();
    const refreshed = await load();
    const bytes = Number.isFinite(result?.bytes_deleted) ? ` ${result.bytes_deleted.toLocaleString()} bytes removed.` : '';
    setStatus(`Deleted the run.${bytes}${refreshed ? '' : ' Refresh the page to update the comparisons.'}`);
    if (!ctx()) document.querySelector('[data-fk="empty:choose"], [data-fk="empty:run"]')?.focus({ preventScroll: true });
    else $('runs-h').focus({ preventScroll: true });
  } catch (error) {
    if (error.partial) {
      closeInspector({ instant: true });
      setData(null);
      renderAll();
      await load();
    }
    status.classList.add('is-error');
    const removed = Number.isFinite(error.partial?.bytes_deleted) && error.partial.bytes_deleted > 0 ? ` ${error.partial.bytes_deleted.toLocaleString()} bytes were already removed.` : '';
    status.textContent = `Deletion did not finish. ${error.message}${removed}`;
  } finally {
    deletingRun = '';
    delete dialog.dataset.busy;
    dialog.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  }
}

function disarmLater() {
  clearTimeout(armTimer);
  armTimer = setTimeout(() => {
    armedRun = '';
    renderRunsNow();
  }, 8000);
}

// Continue a run that stopped without finishing (node lab run --resume): only its
// missing answers are called, so this costs quota.
async function resumeRun(id) {
  try {
    await postJob({ command: 'run', resume: id });
    setStatus('Resuming the run. Only its missing answers are called. The page updates when it ends.');
    running = 'pending';
    renderRunsNow();
    if (watcher) watcher.now();
  } catch (error) {
    renderRunsNow();
    if (error.status === 409) setStatus('Another job runs now. Resume when it ends.', 'error');
    else setStatus(`The resume did not start: ${error.message}.`, 'error');
  }
}

async function scoreRun(id, force) {
  if (force && armedRun !== id) {
    armedRun = id;
    renderRunsNow();
    const again = document.querySelector(`[data-fk="score:${CSS.escape(id)}"]`);
    if (again) again.focus({ preventScroll: true });
    disarmLater();
    return;
  }
  armedRun = '';
  clearTimeout(armTimer);
  try {
    await postJob({ command: 'score', run_ids: [id], force });
    setStatus('Scoring the run again. The page updates when it ends.');
    running = 'pending';
    renderRunsNow();
    if (watcher) watcher.now();
  } catch (error) {
    renderRunsNow();
    if (error.status === 409) setStatus('Another job runs now. Score again when it ends.', 'error');
    else setStatus(`Scoring did not start: ${error.message}.`, 'error');
  }
}

function paintJobBar(detail) {
  const bar = $('jobbar');
  const job = detail.job;
  const was = running;
  running = detail.running || null;
  if (Boolean(was) !== Boolean(running)) renderRunsNow();
  if (!job || job.dry_run) {
    bar.hidden = true;
    return;
  }
  const p = detail.progress;
  const name = jobTitle(job);
  $('jobbar-text').textContent = `${name}${progressText(p) ? ` · ${progressText(p)}` : ' is running'}`;
  const share = p && p.total ? Math.min(1, p.done / p.total) : 0;
  $('jobbar-fill').style.width = `${(share * 100).toFixed(1)}%`;
  bar.classList.toggle('is-open-ended', !(p && p.total));
  bar.href = job.command === 'run' ? '/#run' : '/#lab';
  bar.hidden = false;
}

async function jobFinished(job) {
  if (job.command !== 'run' && job.command !== 'score') return;
  const ok = await load();
  if (!ok) return;
  if (job.command === 'run') setStatus(job.status === 'passed' ? 'A run finished. The results are up to date.' : `A run ${job.status === 'stopped' ? 'stopped' : 'failed'}. The results show what it stored.`, job.status === 'passed' ? '' : 'error');
  else setStatus(job.status === 'passed' ? 'Scoring finished. The results are up to date.' : 'Scoring failed. Open Lab to read its output.', job.status === 'passed' ? '' : 'error');
}

/* ---------- Rating ---------- */
const afterRating = () => {
  load();
};

function startRating(openerFk) {
  const o = reviewStartObs();
  if (!o) {
    setStatus('No answer to rate: every try of the shown setups gave no answer.', 'error');
    return;
  }
  openReview(o.id, { openerFk, saved: afterRating });
}

/* ---------- Events ---------- */
async function onClick(event) {
  const el = event.target.closest('[data-act]');
  if (shareOpen() && !event.target.closest('.share')) toggleShare(false);
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const fk = el.dataset.fk || null;
  switch (act) {
    case 'section':
      moveToSection(el.dataset.section);
      break;
    case 'reload':
      await load({ initial: !S.data });
      break;
    case 'inspect':
      openInspector(el.dataset.obs, { openerFk: fk });
      break;
    case 'inspect-output':
      openInspector(el.dataset.obs, { tab: 'output', openerFk: fk });
      break;
    case 'insp-close':
      closeInspector();
      break;
    case 'insp-tab':
      S.insp.tab = el.dataset.tab;
      renderInspector();
      document.querySelector(`#inspector [data-tab="${el.dataset.tab}"][role="tab"]`)?.focus();
      break;
    case 'insp-go':
      if (el.dataset.obs) {
        openInspector(el.dataset.obs);
        document.querySelector(`#inspector [data-fk="${CSS.escape(fk)}"]:not(:disabled)`)?.focus();
      }
      break;
    case 'insp-json':
      inspectorJson(el.dataset.obs);
      setStatus('Downloaded this try as JSON.');
      break;
    case 'rate':
      openReview(el.dataset.obs, { openerFk: fk, saved: afterRating });
      break;
    case 'rate-start':
      startRating(fk);
      break;
    case 'rate-value':
      setReview({ value: Number(el.dataset.value), error: '' });
      break;
    case 'rate-pair':
      setReview({ pair: el.dataset.pair, error: '' });
      break;
    case 'review-save':
      await saveReview();
      break;
    case 'review-close':
      closeReview();
      break;
    case 'rate-next': {
      const next = nextReviewObs();
      if (next) openReview(next.id, { saved: afterRating });
      else {
        closeReview();
        setStatus('Every case of the shown setups has a rating now.');
      }
      break;
    }
    case 'only':
      S.only = !onlyOn();
      renderCases();
      writeHash();
      announce(S.only ? 'Showing only the cases where the setups differ.' : 'Showing every case.');
      break;
    case 'case-reset':
      S.caseQuery = '';
      S.caseOutcomes = [];
      S.only = false;
      renderCases();
      writeHash();
      $('case-search').focus({ preventScroll: true });
      announce('Case filters reset. Showing every case.');
      break;
    case 'test-search-clear':
      S.testQuery = '';
      renderTestPicker({ armed: armedBoard });
      $('test-search').focus({ preventScroll: true });
      break;
    case 'setup-search-clear':
      S.setupQuery = '';
      renderSetupPicker(chosen);
      $('setup-search').focus({ preventScroll: true });
      break;
    case 'setup-filters-clear':
      S.setupQuery = '';
      S.setupHarness = '';
      S.setupEffort = '';
      renderSetupPicker(chosen);
      $('setup-search').focus({ preventScroll: true });
      break;
    case 'choose-clear':
      chosen.clear();
      renderSetupPicker(chosen);
      break;
    case 'details':
      S.details = !S.details;
      renderSetups();
      break;
    case 'choose':
      openChooser();
      break;
    case 'choose-apply':
      applyChosen(orderChosen(chosen));
      break;
    case 'choose-best':
      applyChosen(defaultSel(ctx()));
      break;
    case 'dlg-close':
      closeDlg(el.dataset.dlg);
      break;
    case 'change-test':
      armedBoard = '';
      S.testQuery = '';
      renderTestPicker();
      openDlg('pick-test');
      break;
    case 'pick-test':
      closeDlg('pick-test');
      showTest(el.dataset.ctx);
      break;
    case 'open-board':
      openBoard(el.dataset.board);
      break;
    case 'remove-board':
      await removeBoard(el.dataset.board);
      break;
    case 'share-menu':
      toggleShare();
      break;
    case 'share-link': {
      toggleShare(false);
      writeHash();
      const ok = await copyText(location.href);
      setStatus(ok ? 'Link copied. It opens this test with these setups.' : 'The link was not copied. Copy it from the address bar.', ok ? '' : 'error');
      break;
    }
    case 'share-save':
      toggleShare(false);
      renderSaveView();
      openDlg('save-view', '#view-title');
      $('view-title').select();
      break;
    case 'share-md': {
      toggleShare(false);
      const ok = await copyText(markdown());
      setStatus(ok ? 'Table copied as Markdown.' : 'The table was not copied.', ok ? '' : 'error');
      break;
    }
    case 'share-csv':
    case 'share-json':
      toggleShare(false);
      setStatus(saveFile(act === 'share-csv' ? 'csv' : 'json'));
      break;
    case 'share-wide':
    case 'share-square':
      toggleShare(false);
      try {
        await picture(act === 'share-wide' ? 'wide' : 'square');
        setStatus('Picture saved.');
      } catch (error) {
        setStatus(`No picture: ${error.message}`, 'error');
      }
      break;
    case 'score':
      await scoreRun(el.dataset.run, el.dataset.force === '1');
      break;
    case 'resume':
      await resumeRun(el.dataset.run);
      break;
    case 'delete-run':
      if (renderDeleteRun(el.dataset.run)) openDlg('delete-run', '[data-fk="delete:cancel"]');
      break;
    case 'delete-run-confirm':
      await removeRun(el.dataset.run);
      break;
    default:
      break;
  }
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    if (shareOpen()) {
      toggleShare(false);
      $('share-btn').focus();
      return;
    }
    if (S.insp && !document.querySelector('dialog[open]')) {
      closeInspector();
      return;
    }
  }
  if (S.insp && event.target.closest && event.target.closest('#inspector') && tabKeys(event)) return;
}

function onHash() {
  const h = readHash();
  if (!S.data) return;
  const same = h.ctx === S.ctxKey && (!h.cfg || h.cfg.join(',') === S.sel.join(',')) && h.only === S.only && (h.query || '') === S.caseQuery && (h.outcomes || []).join(',') === S.caseOutcomes.join(',');
  if (same && (h.section || 'overview') !== S.section) {
    moveToSection(h.section || 'overview');
    return;
  }
  if (same) return;
  showTest(h.ctx, { cfg: h.cfg, only: h.only, query: h.query || '', outcomes: h.outcomes || [], section: h.section || 'overview' });
}

/* ---------- Start ---------- */
mountShell({ current: 'results' });
wireReview();
wireDialogs(['pick-test', 'pick-setups', 'save-view', 'delete-run']);
document.addEventListener('click', onClick);
document.addEventListener('keydown', onKeydown);
$('case-search').addEventListener('input', (event) => {
  S.caseQuery = event.target.value;
  renderCases();
  writeHash();
});
$('case-outcomes').addEventListener('change', () => {
  S.caseOutcomes = [...$('case-outcomes').querySelectorAll('input:checked')].map((box) => box.value);
  renderCases();
  writeHash();
});
$('test-search').addEventListener('input', (event) => {
  S.testQuery = event.target.value;
  renderTestPicker({ armed: armedBoard });
});
$('setup-search').addEventListener('input', (event) => {
  S.setupQuery = event.target.value;
  renderSetupPicker(chosen);
});
$('setup-filters').addEventListener('change', (event) => {
  const saved = captureFocus();
  if (event.target.id === 'setup-harness') S.setupHarness = event.target.value;
  if (event.target.id === 'setup-effort') S.setupEffort = event.target.value;
  renderSetupPicker(chosen);
  restoreFocus(saved);
});
$('chart-controls').addEventListener('change', (event) => {
  if (event.target.id !== 'chart-metric') return;
  S.chartMetric = event.target.value;
  const saved = captureFocus();
  renderCharts();
  restoreFocus(saved);
});
$('pick-setups').addEventListener('change', (event) => {
  const box = event.target.closest('input[type="checkbox"]');
  if (!box) return;
  if (box.checked) chosen.add(box.value);
  else chosen.delete(box.value);
  renderSetupPicker(chosen);
  document.querySelector(`[data-fk="tick:${CSS.escape(box.value)}"]`)?.focus({ preventScroll: true });
});
$('save-view-form').addEventListener('submit', saveView);
$('charts-more').addEventListener('toggle', renderCharts);
window.addEventListener('hashchange', onHash);
window.addEventListener('lab:jobs', (event) => paintJobBar(event.detail));
window.addEventListener('lab:job-finished', (event) => jobFinished(event.detail));
watchChartWidth();
load({ initial: true }).then(() => {
  watcher = watchJobs();
});
