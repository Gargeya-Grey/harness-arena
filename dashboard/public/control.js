// Model Lab control page: Home, Run and Lab. Starts `node lab` jobs through /api/jobs and shows them.
// No framework. Text from the server goes in with textContent or esc().
import { mountShell, setCurrent, paintRunCard as shellRunCard, setNavDot, setOffline, setMode, readMode, icon, progressText } from './shell.js';
import { runProgress, jobName, jobTitle } from './js/jobwatch.js';
import { setData, contexts } from './js/model.js';
import { verdictFor, caseLabel as soleCase } from './js/summary.js';
import { testTitle, testMeta, shortDate, caseName, plural as words } from './js/words.js';
import { captureDisclosures, restoreDisclosures } from './js/ui.js';
import { caseIds, modelsOf, pairKey, targetLevels, applySharedEffort, experimentTitle, experimentMatches, experimentProblems, initialExperiment, initialSelection, effortLevels, effortLabel, selectionView, runRequest, signalQuery } from './js/run-selection.js';
import { preferredPreset, oneCallSelection, rerunSelection } from './js/control-onboarding.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const svg = icon;
const plural = (n, word) => words(n, word, /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`);
const ago = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return shortDate(iso);
};

async function api(method, url, body, options = {}) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, ...options });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Not JSON.
  }
  if (!res.ok) throw Object.assign(new Error(data?.error || `${res.status} ${res.statusText}`), { status: res.status, data });
  return data;
}

const S = {
  catalog: null,
  state: null,
  stateError: '',
  jobs: [],
  running: null,
  lines: new Map(), // job id -> { next, lines: [] }
  panels: { run: null, lab: null },
  view: 'home',
  fails: 0,
  sel: initialSelection(null),
  expSearch: '',
  family: '',
  preparation: null,
  storage: null,
  storageError: '',
  storageBusy: false,
  resetting: false,
};
const rerunId = new URLSearchParams(location.search).get('rerun');

/* ---------- Toasts ---------- */
function toast(text, tone = 'info') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="mark-s ${tone}"></span><span></span>`;
  el.lastChild.textContent = text;
  $('toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  }, 7000);
}

/* ---------- Navigation ---------- */
// The rail links are hash links (`/#run`); hashchange shows the view. Old view names still open.
const VIEWS = ['home', 'run', 'lab'];
const OLD = { runs: 'lab', harnesses: 'lab', checks: 'lab', activity: 'lab', appearance: 'lab' };
function showView(name, { instant = false } = {}) {
  if (name === 'compare') {
    location.replace('/results.html');
    return;
  }
  name = OLD[name] || name;
  if (!VIEWS.includes(name)) name = 'home';
  S.view = name;
  for (const v of VIEWS) $(`view-${v}`).classList.toggle('active', v === name);
  setCurrent(name, { instant });
  document.title = `${name === 'home' ? 'Model Lab' : name === 'run' ? 'Run' : 'Lab'}${name === 'home' ? '' : ' | Model Lab'}`;
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  window.scrollTo({ top: 0, behavior: 'auto' });
}
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

/* ---------- Jobs ---------- */
async function startJob(body, panel) {
  if (!body) return null;
  try {
    const { job } = await api('POST', '/api/jobs', body);
    S.running = job.id;
    upsertJob(job);
    if (panel) watch(panel, job.id);
    paint();
    schedule(200);
    return job;
  } catch (error) {
    if (error.status === 409 && error.data?.job) {
      toast(`Another job runs now: the ${jobName(error.data.job)}. Wait for it, or stop it.`, 'warn');
      if (panel) watch(panel, error.data.job.id);
    } else toast(error.message, 'err');
    return null;
  }
}
function upsertJob(job) {
  const i = S.jobs.findIndex((j) => j.id === job.id);
  if (i === -1) S.jobs.unshift(job);
  else S.jobs[i] = job;
}
function watch(panel, id) {
  S.panels[panel] = id;
  if (!S.lines.has(id)) S.lines.set(id, { next: 0, lines: [] });
  renderPanel(panel);
  pullLines(id).then(() => {
    renderPanel(panel);
    renderLab();
  }).catch(() => {});
}
const pulling = new Map();
function pullLines(id) {
  if (!pulling.has(id)) pulling.set(id, fetchLines(id).finally(() => pulling.delete(id)));
  return pulling.get(id);
}
async function fetchLines(id) {
  const cache = S.lines.get(id) || { next: 0, lines: [] };
  S.lines.set(id, cache);
  const data = await api('GET', `/api/jobs/${encodeURIComponent(id)}?since=${cache.next}`);
  if (data.first > cache.next) cache.lines.push(`… ${data.first - cache.next} earlier lines dropped`);
  cache.lines.push(...data.lines);
  cache.next = data.first + data.lines.length;
  upsertJob(data.job);
  return data.job;
}
const progressOf = (job) => (job && job.command === 'run' && !job.dry_run ? runProgress(S.lines.get(job.id)?.lines || []) : null);
const lineClass = (line) => (/^\s*(Error|error:)|failed|left_workdir|FAIL|: ERROR /.test(line) ? 'l-err' : /All inputs and records are valid|completed|Dry run:|passed|ready/.test(line) ? 'l-ok' : /warn|skipped|Stopping|not found/i.test(line) ? 'l-warn' : '');
const STATUS = {
  running: ['', 'Running'],
  stopping: ['warn', 'Stopping after the current call'],
  passed: ['ok', 'Finished'],
  failed: ['err', 'Failed'],
  stopped: ['warn', 'Stopped'],
};
function statusTag(job, { shake = false, id = '' } = {}) {
  const [tone, word] = STATUS[job.status] || ['', job.status];
  const mark = job.status === 'passed' ? '<svg class="i check-pop" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>' : job.status === 'running' || job.status === 'stopping' ? '<span class="spinner"></span>' : '';
  const code = job.exit_code != null && job.status === 'failed' ? ` (exit ${job.exit_code})` : '';
  return `<span${id ? ` id="${id}"` : ''} class="tag ${tone}${shake ? ' shake' : ''}">${mark}${esc(word + code)}</span>`;
}

// The test a finished run belongs to: its run ids, read from the log, matched in /api/state.
function contextOfRun(p) {
  const runs = S.state?.runs || [];
  for (const id of p?.runIds || []) {
    const r = runs.find((x) => x.run_id === id);
    if (r) return r.context_key;
  }
  return null;
}

function runSummary(job, p) {
  if (job.status === 'running' || job.status === 'stopping') {
    if (!p.total) return 'Starting the harness…';
    const k = p.current && S.state?.cases?.[p.current];
    const now = k ? caseName(p.current, k.suite || '', k.input) : p.current;
    return `${progressText(p)}${p.errors ? ` · ${plural(p.errors, 'error')}` : ''}${p.incomplete ? ` · ${p.incomplete} unfinished, unjudged` : ''}${now ? ` · last: ${now}` : ''}`;
  }
  const answers = p.done - p.errors - (p.incomplete || 0);
  if (job.status === 'passed') return `Done: ${plural(answers, 'answer')}${p.errors ? `, ${plural(p.errors, 'error')}` : ''}${p.incomplete ? `, ${p.incomplete} unfinished and unjudged` : ''}.`;
  if (p.incomplete && p.incomplete === p.done && !p.errors) return `${p.incomplete} unfinished and unjudged. Read the log for the execution cutoff.`;
  if (job.status === 'stopped') return `Stopped after ${plural(p.done, 'call')}. What it stored is kept.`;
  return `The run failed after ${plural(p.done, 'call')}. Read the log for the reason.`;
}

function renderPanel(panel) {
  const id = S.panels[panel];
  const host = $(`${panel}-job`);
  if (!host || !id) return;
  const sect = $(`${panel}-output-sect`);
  if (sect) sect.hidden = false;
  const job = S.jobs.find((j) => j.id === id);
  if (!job) return;
  const cache = S.lines.get(id) || { lines: [] };
  const live = job.status === 'running' || job.status === 'stopping';
  const p = progressOf(job);
  if (host.dataset.job !== id || host.dataset.status !== job.status) {
    const disclosures = captureDisclosures(host);
    const stopWord = job.status === 'stopping' ? 'Stop now' : job.command === 'run' && !job.dry_run ? 'Stop after this call' : 'Stop';
    const ctxKey = !live && p ? contextOfRun(p) : null;
    const foot = !live && p && p.done > 0
      ? `<a class="btn primary small" href="/results.html${ctxKey ? `#ctx=${encodeURIComponent(ctxKey)}` : ''}">See results</a>`
      : !live && job.dry_run ? '<p class="job-note">Preview only: nothing was called or written. Press Start run to call the models.</p>' : '';
    host.innerHTML = `<div class="job-head">${statusTag(job, { shake: host.dataset.job === id && job.status === 'failed' })}<span class="job-name"></span>${live ? `<button type="button" class="btn danger small" data-stop="${esc(id)}">${stopWord}</button>` : ''}</div>
      ${p ? '<div class="prog"><div class="progress"><i></i></div><p class="prog-text"></p></div>' : ''}
      <details class="log-box" id="${panel}-log-${esc(id)}"${p ? '' : ' open'}><summary class="disclose">${p ? 'Show the log' : 'Log'}</summary><p class="job-cmd"><code></code></p><pre class="log" tabindex="0" aria-label="Log"></pre></details>
      <div class="job-foot">${foot}</div>`;
    host.querySelector('.job-name').textContent = jobTitle(job);
    host.querySelector('.job-cmd code').textContent = job.args.join(' ');
    host.dataset.job = id;
    host.dataset.status = job.status;
    host.dataset.shown = '0';
    restoreDisclosures(disclosures, host);
  }
  if (p) {
    const share = p.total ? Math.min(1, p.done / p.total) : 0;
    host.querySelector('.progress i').style.width = `${(share * 100).toFixed(1)}%`;
    host.querySelector('.progress').classList.toggle('is-open-ended', live && !p.total);
    host.querySelector('.prog-text').textContent = runSummary(job, p);
  }
  const log = host.querySelector('.log');
  const shown = Number(host.dataset.shown);
  if (cache.lines.length > shown) {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
    const frag = document.createDocumentFragment();
    for (const line of cache.lines.slice(shown)) {
      const span = document.createElement('span');
      const cls = lineClass(line);
      if (cls) span.className = cls;
      span.textContent = `${line}\n`;
      frag.append(span);
    }
    log.append(frag);
    host.dataset.shown = String(cache.lines.length);
    if (stick) log.scrollTop = log.scrollHeight;
  }
}
const renderAllPanels = () => Object.keys(S.panels).forEach(renderPanel);

async function stopJob(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const { job } = await api('POST', `/api/jobs/${encodeURIComponent(id)}/cancel`, {});
    upsertJob(job);
    paint();
    schedule(200);
  } catch (error) {
    if (btn) btn.disabled = false;
    toast(error.message, 'err');
  }
}
document.addEventListener('click', (e) => {
  const stop = e.target.closest('[data-stop]');
  if (stop) stopJob(stop.dataset.stop, stop);
});

/* ---------- Polling ---------- */
let timer = null;
let polling = false;
function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(poll, ms);
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const before = new Map(S.jobs.map((j) => [j.id, j.status]));
    const list = await api('GET', '/api/jobs');
    S.fails = 0;
    setOffline(false);
    S.jobs = list.jobs;
    S.running = list.running;
    const watched = new Set(Object.values(S.panels).filter(Boolean));
    if (S.running) watched.add(S.running);
    for (const id of watched) {
      const was = before.get(id);
      const job = S.jobs.find((j) => j.id === id);
      if (!job) continue;
      const cache = S.lines.get(id);
      if (job.lines > (cache?.next ?? 0) || job.status !== was) await pullLines(id);
    }
    const ended = S.jobs.filter((job) => {
      const was = before.get(job.id);
      return (was === 'running' || was === 'stopping') && job.status !== was;
    });
    if (ended.some((job) => job.command === 'run' || job.command === 'score')) await Promise.all([loadState(), loadStorage()]);
    ended.forEach(finished);
    paint();
  } catch {
    S.fails += 1;
    if (S.fails >= 2) {
      setOffline(true);
      shellRunCard({ offline: true });
    }
  }
  polling = false;
  schedule(document.hidden ? 60000 : S.running ? 1000 : 4000);
}
document.addEventListener('visibilitychange', () => !document.hidden && schedule(0));

function finished(job) {
  const word = { passed: 'finished', failed: 'failed', stopped: 'stopped' }[job.status] || job.status;
  const name = jobName(job);
  toast(`The ${name} ${word}.`, job.status === 'passed' ? 'ok' : job.status === 'failed' ? 'err' : 'warn');
  // A finished run's panel re-renders with See results, now that /api/state knows the run.
  for (const panel of Object.keys(S.panels)) {
    if (S.panels[panel] === job.id) $(`${panel}-job`).dataset.status = '';
  }
}

function paint() {
  renderAllPanels();
  const job = S.jobs.find((j) => j.id === S.running);
  shellRunCard({ jobs: S.jobs, running: S.running, progress: progressOf(job) });
  syncRunButtons();
  renderHome();
  renderLab();
}

/* ---------- Data ---------- */
async function loadCatalog() {
  S.catalog = await api('GET', '/api/catalog');
  renderRunForm();
  renderLab();
  renderHome();
}
async function loadState() {
  try {
    S.state = await api('GET', '/api/state');
    S.stateError = '';
    setData(S.state);
  } catch (error) {
    S.stateError = error.message;
    toast(`The results did not load: ${error.message}`, 'err');
    renderHome();
    renderProblems();
    return false;
  }
  renderHome();
  renderProblems();
  return true;
}

function invalidateEvidence() {
  S.state = null;
  S.stateError = '';
  setData(null);
  renderHome();
  renderProblems();
}

/* ---------- Home ---------- */
const lastJob = (command) => S.jobs.find((j) => j.command === command && !(j.status === 'running' || j.status === 'stopping'));
function doctorRows(id) {
  const lines = S.lines.get(id)?.lines || [];
  return lines.map((l) => /^(\S+)\s+(built-in|declared)\s+(ready|not found)\s+(partial|none)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ name: m[1], source: m[2], ready: m[3] === 'ready', isolation: m[4], detail: m[5].trim() }));
}
const HALT = { left_workdir: 'the agent wrote outside its folder' };
const FAMILY_DESCRIPTIONS = {
  smoke: 'Short questions to check that your models, harnesses and scoring work.',
  'ladder-answer': 'Reasoning and knowledge questions, from quick answers to demanding problems.',
  'ladder-code': 'Write a JavaScript function for each task. Hidden tests check the results.',
  'ladder-agent': 'Edit a starter project in an isolated folder. Hidden checks score the final files.',
  'visual-web': 'Build web pages and interactive scenes. Scores check delivery; inspect the visual output separately.',
  'foldaway-apartment': 'Build three versions of a folding 3D apartment, with increasing interaction and layout demands.',
};
const familyDescription = suite => FAMILY_DESCRIPTIONS[suite?.id] || suite?.description || '';

const problemsTitle = (n) => `${plural(n, 'record')} ${n === 1 ? 'does' : 'do'} not match the schema`;

function attentionItems() {
  const items = [];
  const problems = S.state?.problems || [];
  if (problems.length) items.push({ tone: 'err', title: problemsTitle(problems.length), sub: problems[0].file, href: '#lab', act: 'Open Lab' });
  const seen = new Set();
  for (const r of (S.state?.runs || []).slice(0, 8)) {
    if (seen.has(r.context_key)) continue;
    seen.add(r.context_key);
    const halt = r.harness?.settings?.halted;
    if (!halt && r.status !== 'failed' && r.execution_status !== 'incomplete') continue;
    const name = r.experiment_id || r.suite?.id || 'run';
    items.push({ tone: 'warn', title: halt ? `The last ${name} run stopped` : r.execution_status === 'incomplete' ? `The last ${name} run has unfinished execution` : `The last ${name} run failed`, sub: halt ? `${HALT[halt] || halt}. ${ago(r.created_at)}.` : r.execution_status === 'incomplete' ? `${plural(r.incomplete_n, 'unfinished attempt')}, unjudged. ${ago(r.created_at)}.` : `${r.rows} of ${r.expected_rows} answers stored, ${plural(r.errors, 'error')}. ${ago(r.created_at)}.`, href: `/results.html#ctx=${encodeURIComponent(r.context_key)}`, act: 'Open the result' });
  }
  const val = lastJob('validate');
  if (val && val.status === 'failed') items.push({ tone: 'err', title: 'Validate found problems', sub: `${ago(val.ended_at)}. Read its output on Lab.`, href: '#lab', act: 'Open Lab' });
  const doc = lastJob('doctor');
  const rows = doc ? doctorRows(doc.id) : [];
  if (rows.length && !rows.some((r) => r.ready)) items.push({ tone: 'warn', title: 'No harness is ready on this machine', sub: 'Install or sign in to a CLI, then check again.', href: '#lab', act: 'Open Lab' });
  return items;
}

function renderHome() {
  renderLibrary();
  // Running job
  const job = S.jobs.find((j) => j.id === S.running);
  const card = $('live-job');
  card.hidden = !job;
  if (job) {
    const p = progressOf(job);
    $('live-title').textContent = `${job.status === 'stopping' ? 'Stopping' : job.dry_run ? 'Previewing' : 'Running'}: ${jobName(job)}`;
    $('live-sub').textContent = p ? runSummary(job, p) : `Started ${ago(job.started_at)}`;
    const share = p && p.total ? Math.min(1, p.done / p.total) : 0;
    $('live-bar').querySelector('i').style.width = `${(share * 100).toFixed(1)}%`;
    $('live-bar').classList.toggle('is-open-ended', !(p && p.total));
    $('live-open').href = job.command === 'run' ? '#run' : '#lab';
    $('live-stop').dataset.stop = job.id;
    $('live-stop').disabled = job.status === 'stopping';
    $('live-stop').textContent = job.status === 'stopping' ? 'Stopping' : job.command === 'run' && !job.dry_run ? 'Stop after this call' : 'Stop';
  }

  // Latest results: the three newest tests, each with its answer.
  const list = $('latest');
  const tests = S.state ? [...contexts()].sort((a, b) => String(b.latest_run_at || '').localeCompare(String(a.latest_run_at || ''))).slice(0, 3) : null;
  let html;
  if (!tests) html = S.stateError ? `<li class="row"><div class="row-text"><h3>Results unavailable</h3><p>${esc(S.stateError)}. Refresh to load current evidence.</p></div></li>` : '<li class="row"><div class="row-text"><p>Reading the results</p></div></li>';
  else if (!tests.length) html = '<li class="row"><div class="row-text"><h3>No results yet</h3><p>Choose a test above. After your first run, Results will show its graphs and outputs.</p></div></li>';
  else {
    html = tests.map((c) => {
      const v = verdictFor(c);
      const meta = [`Suite v${c.suite.version}`, ...testMeta(c, c.config_ids.length, soleCase(c)).split(' · ').slice(1)];
      const scope = c.cases.length === 1 && soleCase(c) ? `1 case: ${soleCase(c)}` : plural(c.cases.length, 'case');
      return `<li><a class="meter recent-result" href="/results.html#ctx=${encodeURIComponent(c.key)}"><span class="meter-val"><b>${esc(testTitle(c))}<span class="recent-scope">${esc(scope)}</span></b><span class="meter-meta meta-parts">${meta.map((part) => `<span>${esc(part)}</span>`).join('')}</span><span class="meter-say">${esc(v.sentences[0] || '')}</span></span>${svg('chev')}</a></li>`;
    }).join('');
  }
  if (list.dataset.html !== html) {
    list.innerHTML = html;
    list.dataset.html = html;
  }
  $('first-sect').hidden = !S.state || (S.state.runs || []).length > 0;

  // Needs attention: only when something does.
  const items = S.state ? attentionItems() : [];
  $('attention-sect').hidden = !items.length;
  const att = items.map((it) => `<li><a class="meter" href="${esc(it.href)}"><span class="mark-s ${it.tone}" aria-hidden="true"></span><span class="meter-val"><b>${esc(it.title)}</b><span>${esc(it.sub)}</span></span><span class="meter-act">${esc(it.act)}</span>${svg('chev')}</a></li>`).join('');
  if ($('attention').dataset.html !== att) {
    $('attention').innerHTML = att;
    $('attention').dataset.html = att;
  }
  setNavDot('lab', items.some((it) => it.href === '#lab') ? 'warn' : '');
}

function renderLibrary() {
  const suites = S.catalog?.suites;
  if (!suites) return;
  $('library-note').textContent = plural(suites.length, 'test family');
  const html = suites.map(suite => {
    const presets = S.catalog.experiments.filter(experiment => experiment.suite === suite.id);
    return `<li class="glass library-card"><div><h3>${esc(suite.title || suite.id)}</h3><p>${esc(familyDescription(suite))}</p></div><p class="library-meta">${esc(plural(suite.case_count ?? suite.cases?.length ?? 0, 'task'))} · ${esc(plural(presets.length, 'preset'))}</p><button type="button" class="btn secondary small" data-suite="${esc(suite.id)}" aria-label="Choose ${esc(suite.title || suite.id)}">Choose and configure${svg('chev')}</button></li>`;
  }).join('');
  const list = $('test-library');
  if (list.dataset.html !== html) {
    list.innerHTML = html;
    list.dataset.html = html;
  }
  const quickPreset = initialExperiment(S.catalog.experiments, null);
  $('quick-try-btn').disabled = !oneCallSelection(quickPreset);
}

/* ---------- Run ---------- */
const currentExp = () => S.catalog?.experiments.find((e) => e.file === S.sel.exp) || null;

function renderRunForm() {
  const exps = S.catalog.experiments;
  let saved = null;
  try {
    saved = localStorage.getItem('lab-exp');
  } catch {
    saved = null;
  }
  S.sel = initialSelection(rerunId ? null : initialExperiment(exps, saved));
  S.family = currentExp()?.suite || '';
  renderFamilies();
  renderExperimentOptions();
  $('exp-note').textContent = plural(exps.length, 'preset');
  pickExp();
}

function selectButton() {
  const button = document.createElement('button');
  button.append(document.createElement('selectedcontent'));
  return button;
}

function renderFamilies() {
  const select = $('suite-select');
  select.replaceChildren(selectButton(), new Option('All test families', ''));
  for (const suite of S.catalog?.suites || []) select.append(new Option(`${suite.title || suite.id} · ${plural(suite.case_count ?? suite.cases?.length ?? 0, 'task')}`, suite.id));
  select.value = S.family;
  const suite = S.catalog?.suites?.find(item => item.id === S.family);
  $('suite-description').textContent = familyDescription(suite) || 'Choose what you want to test, or search across all families.';
}

function renderExperimentOptions() {
  const exps = (S.catalog?.experiments || []).filter(experiment => !S.family || experiment.suite === S.family);
  const matches = exps.filter((experiment) => experimentMatches(experiment, S.expSearch));
  const select = $('exp-select');
  select.replaceChildren(selectButton());
  const selected = currentExp();
  if (selected && !matches.includes(selected)) {
    const group = document.createElement('optgroup');
    group.label = 'Selected preset outside search';
    group.append(new Option(experimentTitle(selected), selected.file));
    select.append(group);
  }
  if (!selected) {
    const placeholder = new Option('Choose a preset', '', true, true);
    placeholder.disabled = true;
    select.append(placeholder);
  }
  for (const experiment of matches) {
    const problems = experimentProblems(experiment);
    select.append(new Option(`${experimentTitle(experiment)}${problems.length ? ' · unavailable' : ''}`, experiment.file));
  }
  select.value = S.sel.exp || '';
  $('exp-search-note').textContent = S.expSearch
    ? `${matches.length} of ${exps.length} presets match.${selected && !matches.includes(selected) ? ' Selected preset is outside these matches.' : ''}${!matches.length ? ' Clear search to see every preset in this family.' : ''}`
    : `${plural(exps.length, 'preset')}. Search keeps your current selection.`;
  $('exp-search-clear').disabled = !S.expSearch;
}

function caseLabel(e, id) {
  const known = S.catalog?.suites?.find(suite => suite.id === e?.suite)?.cases?.find(item => item.case_id === id);
  if (known?.title) return known.title;
  const k = S.state?.cases?.[id];
  return caseName(id, e?.suite || '', k && k.input);
}

function renderChips() {
  const e = currentExp();
  const ids = caseIds(e);
  $('case-chips').innerHTML = ids.length ? ids.map((c) => `<button type="button" class="mchip" aria-pressed="${S.sel.cases.has(c)}" data-case="${esc(c)}" title="${esc(c)}">${esc(caseLabel(e, c))}</button>`).join('') : '<span class="chip muted">No cases found</span>';
}

function pickExp({ reset = true } = {}) {
  const e = currentExp();
  if (reset) S.sel = initialSelection(e);
  const detail = $('exp-detail');
  detail.hidden = false; // empty until the catalog arrives
  if (!e) {
    detail.innerHTML = '<div class="row-text"><p>Choose a test and preset to see its models, harnesses and availability.</p></div>';
    $('edit-notice').hidden = true;
    $('repeats').value = '';
    renderChips();
    renderSetups();
    countCalls();
    return;
  }
  const problems = experimentProblems(e);
  detail.innerHTML = `<h3 class="experiment-title">${esc(experimentTitle(e))}</h3>${e.description ? '<p class="exp-desc"></p>' : ''}<p class="setup-policy">User setup ${e.user_config === 'isolated' ? 'asked to stay out. Each run records what stayed out.' : 'loads through each harness.'}${e.access === 'edit' ? ' Agent task with file edits.' : ''}</p>${problems.length ? `<div class="notice warn"><strong>Unavailable</strong><ul>${problems.map((problem) => `<li>${esc(problem)}</li>`).join('')}</ul></div>` : ''}<details class="config-details" id="experiment-config"><summary>Technical preset details</summary><dl><dt>Exact id</dt><dd><code>${esc(e.id)}</code></dd><dt>File</dt><dd><code>experiments/${esc(e.file)}</code></dd><dt>Suite</dt><dd>${esc(e.suite)}</dd><dt>Prompt</dt><dd>${esc(e.prompt || 'Not specified')}</dd><dt>Model keys</dt><dd>${modelsOf(e).map(model => `<code>${esc(model)}</code>`).join(', ')}</dd></dl></details>`;
  if (e.description) detail.querySelector('.exp-desc').textContent = e.description;
  $('repeats').value = S.sel.repeats;
  $('repeats').placeholder = String(e.repeats);
  $('edit-notice').hidden = e.access !== 'edit';
  renderChips();
  renderSetups();
  countCalls();
}


function countCalls() {
  const e = currentExp();
  const view = selectionView(e, S.sel);
  const { repeats, calls, valid, targets, cases } = view;
  $('plan-n').textContent = String(calls);
  $('plan-word').textContent = calls === 1 ? 'call' : 'calls';
  $('plan-break').innerHTML = [['Setups', targets.length], ['Cases', cases.length], ['Tries per case', Number.isInteger(repeats) ? repeats : '–']]
    .map(([k, v]) => `<dt>${k}</dt><dd class="num">${esc(v)}</dd>`).join('');
  $('call-count').classList.toggle('bad', !valid);
  $('call-count').textContent = valid ? `${plural(targets.length, 'setup')} × ${plural(cases.length, 'case')} × ${plural(repeats, 'try')}.` : view.problems[0];
  $('narrow-sum').textContent = `${plural(cases.length, 'case')} included`;
  $('cases-note').textContent = `${cases.length} of ${caseIds(e).length} included. Select at least one.`;
  $('one-call-btn').disabled = !oneCallSelection(e);
  $('repeats-hint').textContent = repeats < 3 ? 'Use 3 or more to compare setups. Fewer is fine for a first look.' : 'Enough tries to compare setups.';
  disarm();
  syncRunButtons();
  scheduleSignal();
  return calls;
}

function setupRows() {
  const catalog = new Map((S.catalog?.setups ?? []).map(setup => [pairKey(setup), setup]));
  return selectionView(currentExp(), S.sel).targets.map(row => ({ ...catalog.get(pairKey(row)), ...row }));
}

function setOptions(select, choices, placeholder = '') {
  const previous = select.value;
  select.replaceChildren(selectButton(), ...(placeholder ? [new Option(placeholder, '')] : []),
    ...choices.map(([value, label]) => new Option(label, value)));
  if (choices.some(([value]) => value === previous)) select.value = previous;
  select.disabled = !choices.length;
}

function renderSetupPicker() {
  const available = S.catalog?.setups ?? [];
  const harnesses = S.catalog?.harnesses ?? [];
  const harness = $('setup-harness');
  const provider = $('setup-provider');
  const model = $('setup-model');
  const effort = $('setup-new-effort');
  const options = values => [...new Set(values)].sort().map(value => [value, value]);
  setOptions(harness, options(harnesses.map(item => item.name)));
  const inHarness = available.filter(setup => setup.harness === harness.value);
  setOptions(provider, options(inHarness.map(setup => setup.provider)));
  const routes = new Map();
  for (const item of inHarness.filter(setup => setup.provider === provider.value)) {
    const saved = routes.get(item.model_id);
    const sameLevels = saved && JSON.stringify(targetLevels(saved)) === JSON.stringify(targetLevels(item));
    if (!saved || (item.discovered && !sameLevels && targetLevels(item).length)
      || (!item.discovered && saved.discovered && (sameLevels || !targetLevels(saved).length))) routes.set(item.model_id, item);
  }
  const inProvider = [...routes.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  setOptions(model, inProvider.map(setup => [setup.model, setup.display_name === setup.model_id ? setup.model_id : `${setup.display_name} (${setup.model_id})`]));
  const setup = inProvider.find(setup => setup.model === model.value);
  const used = setup ? setupRows().filter(row => pairKey(row) === pairKey(setup)).map(row => row.effort) : [];
  const levels = setup ? targetLevels(setup).filter(level => !used.includes(level)) : [];
  setOptions(effort, levels.map(level => [level, effortLabel(level)]));
  const source = harnesses.find(item => item.name === harness.value);
  const discovery = source?.discovery;
  const status = source?.installed === false ? 'CLI is missing from PATH.'
    : discovery?.status === 'ready' ? `${plural(discovery.count, 'model')} reported by the CLI.`
      : discovery?.message || 'Refresh to check the installed CLI for more models.';
  const routeStatus = !setup ? 'No model routes are currently listed.' : effort.disabled
    ? targetLevels(setup).length ? 'All verified efforts for this setup are included.' : 'No verified thinking-effort levels are available for this model on this harness.'
    : '';
  $('setup-picker-note').textContent = [status, routeStatus].filter(Boolean).join(' ');
  $('add-setup').disabled = !currentExp() || !levels.length;
  return setup;
}

function renderSetups() {
  const rows = setupRows();
  const host = $('setup-list');
  host.replaceChildren();
  if (!rows.length) {
    const note = document.createElement('p');
    note.className = 'selection-note';
    note.textContent = 'Add a model setup to continue.';
    host.append(note);
  }
  rows.forEach((row, index) => {
    const card = document.createElement('div');
    card.className = 'setup-row';
    card.innerHTML = `<div class="row-text"><h3 id="setup-name-${index}">${esc(row.display_name || row.model)}</h3><p>${esc([row.harness, row.provider, row.model_id].filter(Boolean).join(' | '))}</p></div>
      <div><label id="setup-label-${index}" for="setup-effort-${index}">Thinking effort</label><select id="setup-effort-${index}" data-row-effort="${index}" aria-labelledby="setup-name-${index} setup-label-${index}"></select></div>
      <button type="button" class="btn quiet small" data-remove-setup="${index}" aria-label="Remove ${esc(row.display_name || row.model)} on ${esc(row.harness)} at ${esc(effortLabel(row.effort || 'default'))}">Remove</button>`;
    const select = card.querySelector('select');
    const levels = targetLevels(row);
    const choices = levels.map(level => [level, effortLabel(level)]);
    if (!levels.includes(row.effort)) choices.unshift([row.effort || 'default', effortLabel(row.effort || 'default')]);
    setOptions(select, choices);
    select.value = row.effort || 'default';
    select.disabled = !levels.length || (levels.length === 1 && levels[0] === row.effort);
    host.append(card);
  });
  $('setups-count').textContent = plural(rows.length, 'setup');
  $('restore-setups').disabled = !currentExp();
  $('clear-setups').disabled = !rows.length;
  const shared = effortLevels(currentExp(), { ...S.sel, customTargets: rows }).filter(level => level !== 'unavailable');
  const bulk = $('effort-select');
  setOptions(bulk, shared.map(level => [level, effortLabel(level)]), 'Choose a shared effort');
  bulk.value = '';
  $('effort-note').textContent = shared.length
    ? 'Only levels shared by every setup are available. Matching setups merge when they use the same effort.'
    : rows.length ? 'These setups share no adjustable effort level. Use the individual controls above.' : 'Add a model to see its thinking efforts.';
  renderSetupPicker();
}

function updateSetups(rows, focusId) {
  S.sel = { ...S.sel, effort: '', customTargets: rows };
  renderSetups();
  if (focusId) $(focusId)?.focus();
  countCalls();
}

function renderPreparation() {
  const host = $('preparation-note');
  host.hidden = !S.preparation;
  host.classList.toggle('warn', S.preparation?.tone === 'warn');
  host.textContent = S.preparation?.message || '';
}

function clearPreparation() {
  S.preparation = null;
  renderPreparation();
  const url = new URL(location.href);
  if (url.searchParams.has('rerun')) {
    url.searchParams.delete('rerun');
    history.replaceState(null, '', url);
  }
}

function chooseFamily(family) {
  clearPreparation();
  S.family = family;
  S.expSearch = '';
  $('exp-search').value = '';
  const experiment = family ? preferredPreset(S.catalog, family, S.sel.exp) : currentExp();
  S.sel = initialSelection(experiment);
  renderFamilies();
  renderExperimentOptions();
  pickExp();
  if (experiment && !experimentProblems(experiment).length) writePref('lab-exp', experiment.file);
}

function prepareOneCall(experiment) {
  const selection = oneCallSelection(experiment);
  if (!selection) return;
  clearPreparation();
  S.sel = selection;
  S.family = experiment.suite;
  S.expSearch = '';
  $('exp-search').value = '';
  S.preparation = { message: 'A one-call try was prepared. Review or change the model, harness, case and thinking effort below, then Preview. No model has been called.' };
  renderPreparation();
  renderFamilies();
  renderExperimentOptions();
  pickExp({ reset: false });
  showView('run');
  $('setups-h').scrollIntoView({ block: 'nearest' });
}

async function loadRerun(id) {
  S.preparation = { message: `Reading the saved selection from run ${id}. No model will be called.` };
  renderPreparation();
  try {
    const payload = await api('GET', `/api/rerun?run_id=${encodeURIComponent(id)}`);
    const result = rerunSelection(S.catalog, payload);
    if (!result.selection) throw new Error(result.problems.join(' '));
    S.sel = result.selection;
    S.family = currentExp().suite;
    S.preparation = { message: `Prepared from run ${payload.source?.run_id || id}. ${payload.note || 'Review the selection and Preview before starting a new run.'} No model has been called.` };
  } catch (error) {
    S.sel = initialSelection(null);
    S.family = '';
    S.preparation = { tone: 'warn', message: `This run cannot be prepared. ${error.message} Choose a test and preset explicitly to continue.` };
  }
  renderPreparation();
  renderFamilies();
  renderExperimentOptions();
  pickExp({ reset: false });
  showView('run', { instant: true });
}

/* The signal check (GET /api/signal, node lab signal): an estimate from stored runs, shown before the buttons. */
const SIGNAL_WORD = { 'worth running': ['ok', 'Worth running'], 'low signal': ['warn', 'Low signal'], unknown: ['info', 'Unknown'] };
let signalSeq = 0;
let signalTimer = null;
let signalController = null;
function signalBox() {
  let box = $('signal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'signal';
    box.className = 'signal';
    box.setAttribute('aria-live', 'polite');
    $('edit-notice').after(box);
  }
  return box;
}
const tokenTotal = (items) => {
  const known = items.filter((item) => item.estimate != null);
  if (!known.length) return 'unknown';
  const total = known.reduce((sum, item) => sum + item.estimate, 0).toLocaleString('en-US');
  return known.length === items.length ? total : `${total} and more (${plural(items.length - known.length, 'setup')} unknown)`;
};
function paintSignal(r) {
  const [tone, word] = SIGNAL_WORD[r.result] || ['info', r.result];
  const predicted = r.pairs.map((pair) => pair.predicted_disagreements).filter((n) => n != null);
  const rows = [
    ['Planned calls', r.planned_calls],
    ['Little chance of new information', r.calls_low_information ?? 'unknown'],
    ['Output tokens (estimate)', tokenTotal(r.output_tokens)],
    ['Disagreements a pair needs', r.pairs.length ? r.pairs[0].needed : 'no pair'],
    ['History predicts, best pair', r.pairs.length ? (predicted.length ? Math.max(...predicted) : 'unknown') : 'no pair'],
    ['Check quality', `${r.checks.state}${r.checks.kill_rate == null ? '' : `, ${Math.round(r.checks.kill_rate * 100)}% caught`}`],
    ['Setup state', [...new Set(r.setups.map((s) => s.setup_state))].map((state) => `${r.setups.filter((s) => s.setup_state === state).length} ${state}`).join(', ')],
  ];
  const box = signalBox();
  const disclosures = captureDisclosures(box);
  box.hidden = false;
  box.classList.remove('busy');
  box.innerHTML = `<div class="signal-head"><span class="mark-s ${tone}" aria-hidden="true"></span><b>${esc(word)}</b></div>`
    + `<ul class="signal-why">${r.reasons.slice(0, 2).map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul>`
    + `<details class="signal-more" id="signal-details"><summary class="disclose">Signal details${r.reasons.length > 2 ? ` · ${plural(r.reasons.length - 2, 'more reason')}` : ''}</summary>${r.reasons.length > 2 ? `<ul class="signal-why">${r.reasons.slice(2).map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul>` : ''}<dl class="plan-break">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd>`).join('')}</dl><p class="plan-foot">${esc(r.note)}</p></details>`;
  restoreDisclosures(disclosures, box);
}
async function loadSignal() {
  const box = signalBox();
  const query = signalQuery(currentExp(), S.sel);
  if (!query) {
    box.hidden = true;
    return;
  }
  signalController = new AbortController();
  const seq = ++signalSeq;
  try {
    const report = await api('GET', `/api/signal?${query}`, undefined, { signal: signalController.signal });
    if (seq === signalSeq) paintSignal(report);
  } catch (error) {
    if (seq !== signalSeq) return;
    box.classList.remove('busy');
    box.innerHTML = `<div class="signal-head"><span class="mark-s warn" aria-hidden="true"></span><b>No signal check</b></div><ul class="signal-why"><li></li></ul>`;
    box.querySelector('li').textContent = `The check could not run: ${error.message}`;
  }
}
function scheduleSignal() {
  signalSeq += 1;
  clearTimeout(signalTimer);
  signalController?.abort();
  signalController = null;
  const box = signalBox();
  if (!selectionView(currentExp(), S.sel).valid) {
    box.hidden = true;
    box.innerHTML = '';
    box.classList.remove('busy');
    return;
  }
  box.hidden = false;
  box.classList.add('busy');
  box.innerHTML = '<p class="signal-why">Checking stored runs…</p>';
  signalTimer = setTimeout(loadSignal, 300);
}
function syncRunButtons() {
  const view = selectionView(currentExp(), S.sel);
  const none = !view.valid;
  $('start-btn').disabled = none || Boolean(S.running);
  $('preview-btn').disabled = none || Boolean(S.running);
  const reason = S.running ? 'Wait for the current job to end.' : view.problems[0] || '';
  $('start-btn').title = reason;
  $('preview-btn').title = reason;
}
$('exp-search').addEventListener('input', (event) => {
  S.expSearch = event.target.value;
  renderExperimentOptions();
});
$('exp-search-clear').addEventListener('click', () => {
  S.expSearch = '';
  $('exp-search').value = '';
  renderExperimentOptions();
  $('exp-search').focus();
});
$('exp-select').addEventListener('change', (e) => {
  clearPreparation();
  S.sel.exp = e.target.value;
  if (!experimentProblems(currentExp()).length) writePref('lab-exp', S.sel.exp);
  pickExp();
  renderExperimentOptions();
});
$('suite-select').addEventListener('change', event => chooseFamily(event.target.value));
$('effort-select').addEventListener('change', event => {
  if (event.target.value) updateSetups(applySharedEffort(setupRows(), event.target.value), 'effort-select');
});
$('refresh-models').addEventListener('click', async () => {
  const button = $('refresh-models');
  const status = $('refresh-models-status');
  button.disabled = true;
  status.textContent = 'Reading model catalogs from installed CLIs. No model calls are made.';
  try {
    S.catalog = await api('POST', '/api/catalog/refresh', {});
    if (S.sel.customTargets) {
      const setups = new Map(S.catalog.setups.map(setup => [pairKey(setup), setup]));
      S.sel.customTargets = S.sel.customTargets.map(row => {
        const setup = setups.get(pairKey(row));
        return { ...(setup ?? { ...row, choices: [] }), effort: row.effort };
      });
    }
    renderSetups();
    countCalls();
    const connected = S.catalog.harnesses.filter(item => item.discovery?.status === 'ready');
    const total = connected.reduce((sum, item) => sum + item.discovery.count, 0);
    status.textContent = connected.length ? `${plural(total, 'model route')} found across ${plural(connected.length, 'harness')}.` : 'No CLI catalogs were loaded. Choose a harness for details.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
for (const id of ['setup-harness', 'setup-provider', 'setup-model']) {
  $(id).addEventListener('change', renderSetupPicker);
}
$('add-setup').addEventListener('click', () => {
  const setup = renderSetupPicker();
  if ($('add-setup').disabled) return;
  const rows = setupRows();
  updateSetups([...rows, { ...setup, effort: $('setup-new-effort').value }], `setup-effort-${rows.length}`);
});
$('restore-setups').addEventListener('click', () => {
  S.sel = { ...initialSelection(currentExp()), cases: S.sel.cases, repeats: S.sel.repeats };
  clearPreparation();
  renderSetups();
  countCalls();
});
$('clear-setups').addEventListener('click', () => updateSetups([], 'setup-harness'));
$('setup-list').addEventListener('change', event => {
  const index = Number(event.target.dataset.rowEffort);
  const rows = setupRows().map((row, i) => i === index ? { ...row, effort: event.target.value } : row);
  updateSetups(rows, event.target.id);
});
$('setup-list').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-setup]');
  if (!button) return;
  const index = Number(button.dataset.removeSetup);
  const rows = setupRows().filter((_, i) => i !== index);
  updateSetups(rows);
  ($('setup-list').querySelector(`[data-remove-setup="${Math.min(index, rows.length - 1)}"]`) || $('setup-harness')).focus();
});
$('quick-try-btn').addEventListener('click', () => prepareOneCall(initialExperiment(S.catalog?.experiments || [], null)));
$('one-call-btn').addEventListener('click', () => prepareOneCall(currentExp()));
document.addEventListener('click', (e) => {
  const family = e.target.closest('[data-suite]');
  if (family) {
    chooseFamily(family.dataset.suite);
    showView('run');
    $('exp-select').focus({ preventScroll: true });
    return;
  }
  const action = e.target.closest('[data-select]');
  if (action) {
    S.sel.cases = new Set(action.dataset.selection === 'all' ? caseIds(currentExp()) : []);
    renderChips();
    countCalls();
    return;
  }
  const chip = e.target.closest('[data-case].mchip');
  if (!chip) return;
  const on = chip.getAttribute('aria-pressed') !== 'true';
  chip.setAttribute('aria-pressed', String(on));
  if (on) S.sel.cases.add(chip.dataset.case);
  else S.sel.cases.delete(chip.dataset.case);
  countCalls();
});
$('repeats').addEventListener('input', (e) => {
  S.sel.repeats = e.target.value.trim();
  countCalls();
});
function runBody(dry) {
  return runRequest(currentExp(), S.sel, dry);
}
const showOutput = () => $('run-output-sect').scrollIntoView({ behavior: 'smooth', block: 'start' });
$('preview-btn').addEventListener('click', async () => {
  const job = await startJob(runBody(true), 'run');
  if (job) {
    $('run-output-note').textContent = 'Preview: nothing is called or written';
    showOutput();
  }
});
let armTimer = null;
function disarm() {
  clearTimeout(armTimer);
  const b = $('start-btn');
  b.classList.remove('armed');
  b.classList.add('primary');
  b.textContent = 'Start run';
}
$('start-btn').addEventListener('click', async () => {
  const b = $('start-btn');
  if (!selectionView(currentExp(), S.sel).valid || S.running) return;
  if (!b.classList.contains('armed')) {
    const e = currentExp();
    const calls = countCalls();
    b.classList.remove('primary');
    b.classList.add('armed');
    b.textContent = `Start ${plural(calls, 'call')}${e.access === 'edit' ? ' with edits' : ''}?`;
    armTimer = setTimeout(disarm, 5000);
    return;
  }
  disarm();
  b.disabled = true;
  b.innerHTML = '<span class="spinner"></span>Starting';
  const job = await startJob(runBody(false), 'run');
  b.textContent = 'Start run';
  countCalls();
  if (job) {
    clearPreparation();
    $('run-output-note').textContent = 'Live: the models are called through your sign-ins';
    showOutput();
  }
});

/* ---------- Lab ---------- */
const bytesText = value => {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const unit = bytes < 1024 ** 2 ? 'KB' : bytes < 1024 ** 3 ? 'MB' : 'GB';
  const divisor = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit];
  return `${(bytes / divisor).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
};

async function loadStorage() {
  S.storageBusy = true;
  renderStorage();
  try {
    S.storage = await api('GET', '/api/storage');
    S.storageError = '';
  } catch (error) {
    S.storageError = `Storage could not be read. ${error.message}`;
  } finally {
    S.storageBusy = false;
    renderStorage();
  }
}

function renderStorage() {
  const storage = S.storage;
  $('storage-note').textContent = S.storageError ? 'Unavailable' : storage ? `${plural(storage.run_count, 'saved run')} · ${bytesText(storage.bytes)}` : 'Reading saved data';
  $('storage-status').textContent = S.storageError || (storage ? `${plural(storage.run_count, 'saved run')} use ${bytesText(storage.bytes)} in run files. The data locations are below.` : 'Reading saved run history.');
  const labels = { data: 'Data folder', results: 'Run folders', annotations: 'Ratings', boards: 'Saved views', reports: 'Derived reports', ledger: 'Evidence ledger' };
  const html = storage ? Object.entries(labels).map(([key, label]) => {
    const values = Array.isArray(storage.paths[key]) ? storage.paths[key] : [storage.paths[key]];
    return `<dt>${label}</dt><dd>${values.filter(Boolean).map(value => `<code title="${esc(value.absolute)}">${esc(value.display || value.absolute)}</code>`).join('<br>')}</dd>`;
  }).join('') : '';
  const paths = $('storage-paths');
  if (paths.dataset.html !== html) {
    paths.innerHTML = html;
    paths.dataset.html = html;
  }
  const unknown = storage?.unknown || [];
  $('storage-unknown').hidden = !unknown.length;
  $('storage-unknown').textContent = unknown.length ? `History cannot be cleared while ${plural(unknown.length, 'unknown entry')} remain in the run folders. They are preserved. ${unknown.map(item => item.display_path || item.path).join(', ')}` : '';
  $('storage-refresh').disabled = S.storageBusy || S.resetting;
  $('storage-reset').disabled = !storage || Boolean(S.storageError) || S.storageBusy || S.resetting || Boolean(S.running) || Boolean(unknown.length);
  $('storage-reset').title = S.running ? 'Wait for the current job to finish.' : '';
  $('reset-submit').disabled = $('reset-confirm').value !== 'DELETE ALL RUNS' || S.resetting || Boolean(S.running);
}

$('storage-refresh').addEventListener('click', loadStorage);
$('storage-reset').addEventListener('click', async () => {
  await loadStorage();
  if ($('storage-reset').disabled) return;
  const storage = S.storage;
  const locations = (storage.paths.results || []).map(item => item.absolute || item.display).join(', ');
  $('reset-description').textContent = `This will delete ${plural(storage.run_count, 'saved run')}, using ${bytesText(storage.bytes)} in run files, from ${locations}. Ratings, saved views and derived reports will also be cleared.`;
  $('reset-confirm').value = '';
  $('reset-error').textContent = '';
  renderStorage();
  $('reset-dialog').showModal();
});
$('reset-confirm').addEventListener('input', renderStorage);
$('reset-dialog').addEventListener('close', () => {
  $('reset-dialog').returnValue = '';
  $('reset-confirm').value = '';
  renderStorage();
});
$('reset-form').addEventListener('submit', async event => {
  if (event.submitter?.value !== 'delete') return;
  event.preventDefault();
  if ($('reset-submit').disabled) return;
  S.resetting = true;
  $('reset-error').textContent = 'Clearing saved run history…';
  renderStorage();
  try {
    const result = await api('POST', '/api/storage/reset', { confirm: 'DELETE ALL RUNS' });
    invalidateEvidence();
    S.jobs = [];
    S.running = null;
    S.lines.clear();
    S.panels = { run: null, lab: null };
    for (const panel of ['run', 'lab']) {
      $(`${panel}-job`).innerHTML = '';
      for (const key of ['job', 'status', 'shown']) delete $(`${panel}-job`).dataset[key];
      $(`${panel}-output-sect`).hidden = true;
    }
    for (const command of ['validate', 'score', 'report']) $(`${command}-tag`).hidden = true;
    await Promise.all([loadState(), loadStorage()]);
    await poll();
    paint();
    $('reset-dialog').close();
    toast(`Deleted ${plural(result.run_count ?? result.run_ids?.length ?? 0, 'saved run')} and freed ${bytesText(result.bytes_deleted)}. Future runs will stay saved.`, 'ok');
  } catch (error) {
    if (error.data?.partial) {
      invalidateEvidence();
      await loadState();
    }
    const removed = error.data?.partial?.bytes_deleted > 0 ? ` ${bytesText(error.data.partial.bytes_deleted)} were already removed.` : '';
    $('reset-error').textContent = `History could not be cleared. ${error.message}${removed}`;
    await loadStorage();
  } finally {
    S.resetting = false;
    renderStorage();
  }
});

function renderHarnesses() {
  const doc = lastJob('doctor');
  const rows = doc ? doctorRows(doc.id) : [];
  const list = $('harness-list');
  let html;
  if (rows.length) {
    $('harness-note').textContent = `${rows.filter((r) => r.ready).length} of ${rows.length} ready · ${ago(doc.ended_at)}`;
    html = rows.map((r) => `<li class="row"><span class="mark-s ${r.ready ? 'ok' : 'warn'}" aria-hidden="true"></span><div class="row-text"><h3>${esc(r.name)} <span class="chip muted">${esc(r.source)}</span></h3><p>${esc(r.ready ? r.detail : `Not found. ${r.detail}`)}</p></div>
      <div class="row-ctl"><span class="chip ${r.isolation === 'partial' ? '' : 'muted'}">isolation ${esc(r.isolation)}</span><span class="sr">${r.ready ? 'Ready' : 'Not found'}</span></div></li>`).join('');
  } else {
    // Another panel may hold an empty cache for this job, so compare line counts.
    if (doc && (S.lines.get(doc.id)?.next ?? 0) < doc.lines) pullLines(doc.id).then(() => { renderLab(); renderHome(); }).catch(() => {});
    $('harness-note').textContent = doc ? 'Reading the last check' : 'Not checked yet';
    html = (S.catalog?.harnesses || []).map((h) => `<li class="row"><span class="mark-s" aria-hidden="true"></span><div class="row-text"><h3>${esc(h.name)} <span class="chip muted">${h.declared ? 'declared' : 'built-in'}</span></h3></div><div class="row-ctl"><span class="chip muted">not checked</span></div></li>`).join('');
  }
  if (list.dataset.html !== html) {
    list.innerHTML = html;
    list.dataset.html = html;
  }
  const b = $('doctor-btn');
  const checking = S.jobs.some((j) => j.command === 'doctor' && (j.status === 'running' || j.status === 'stopping'));
  b.disabled = checking || Boolean(S.running);
  if (checking) b.innerHTML = '<span class="spinner"></span>Checking';
  else b.textContent = 'Check harnesses';
}

function renderRecordTags() {
  for (const cmd of ['validate', 'score', 'report']) {
    const tag = $(`${cmd}-tag`);
    const j = S.jobs.find((x) => x.command === cmd && (cmd !== 'score' || x.args.includes('--all')));
    if (!tag || !j) continue;
    const html = statusTag(j, { id: `${cmd}-tag` });
    if (tag.outerHTML !== html) tag.outerHTML = html;
  }
  document.querySelectorAll('[data-job]').forEach((b) => { b.disabled = Boolean(S.running); });
}

function renderJobs() {
  const ul = $('jobs-list');
  $('jobs-note').textContent = S.jobs.length ? plural(S.jobs.length, 'job') : '';
  const html = S.jobs.length
    ? S.jobs.map((j) => `<li><button type="button" class="meter" data-show-job="${esc(j.id)}" aria-current="${j.id === S.panels.lab}"><span class="meter-val"><b>${esc(jobTitle(j))}</b><span>${esc(ago(j.started_at))}</span></span>${statusTag(j)}${svg('chev')}</button></li>`).join('')
    : '<li class="row"><div class="row-text"><h3>No jobs yet</h3><p>Jobs you start on Run or Lab show here, newest first.</p></div></li>';
  if (ul.dataset.html !== html) {
    ul.innerHTML = html;
    ul.dataset.html = html;
  }
}

// Records that fail their schema, each with its file and the reason, from the last state read.
// A broken file can hold hundreds of bad lines; Validate prints them all.
const SHOWN_PROBLEMS = 8;
function renderProblems() {
  const li = $('problems-row');
  const list = S.state?.problems || [];
  li.hidden = !list.length;
  const html = list.length
    ? `<div class="row-text"><h3><span class="mark-s err" aria-hidden="true"></span>${esc(problemsTitle(list.length))}</h3><p>${list.length > SHOWN_PROBLEMS ? `The first ${SHOWN_PROBLEMS} are below; Validate lists every one. ` : ''}Fix each file, then select Validate.</p></div><ul class="problem-list">${list.slice(0, SHOWN_PROBLEMS).map((p) => `<li><code>${esc(p.file)}</code><span>${esc(p.message)}</span></li>`).join('')}</ul>`
    : '';
  if (li.dataset.html !== html) {
    li.innerHTML = html;
    li.dataset.html = html;
  }
}

function renderLab() {
  renderHarnesses();
  renderProblems();
  renderRecordTags();
  renderJobs();
  renderStorage();
  const id = S.panels.lab;
  const job = id && S.jobs.find((j) => j.id === id);
  $('lab-cols').classList.toggle('has-output', Boolean(job));
  $('lab-output-col').hidden = !job;
  $('lab-output-sect').hidden = !job;
  $('lab-output-h').textContent = job ? jobTitle(job) : 'Output';
  $('lab-output-note').textContent = job ? ago(job.started_at) : '';
}

const showLabOutput = () => {
  renderLab();
  $('lab-job').focus({ preventScroll: true });
  if (window.matchMedia('(max-width: 1179px)').matches) $('lab-output-sect').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-job]');
  if (b) {
    const body = b.dataset.job === 'score' ? { command: 'score', all: true } : { command: b.dataset.job };
    const job = await startJob(body, 'lab');
    if (job) showLabOutput();
    return;
  }
  const show = e.target.closest('[data-show-job]');
  if (show) {
    watch('lab', show.dataset.showJob);
    renderJobs();
    showLabOutput();
  }
});
$('doctor-btn').addEventListener('click', async () => {
  const job = await startJob({ command: 'doctor' }, 'lab');
  if (job) {
    renderHarnesses();
    showLabOutput();
  }
});

/* ---------- Appearance ---------- */
const THEMES = [['forest', 'Forest', 165, 1], ['ocean', 'Ocean', 232, 1], ['plum', 'Plum', 318, 0.95], ['ember', 'Ember', 32, 1], ['graphite', 'Graphite', 230, 0.12]];
function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not saved.
  }
}
function renderAppearance() {
  const theme = readPref('lab-theme', 'forest');
  $('swatches').innerHTML = THEMES.map(([id, name, h, k]) => `<button type="button" class="swatch" role="radio" aria-checked="${id === theme}" aria-label="${name}" tabindex="${id === theme ? 0 : -1}" data-theme="${id}" style="--sh:${h};--sk:${k}"><svg viewBox="0 0 38 16" aria-hidden="true"><path class="sw-body" d="M0 8 C7 3 14 .8 22 .8 L30 .8 A7.2 7.2 0 0 1 30 15.2 L22 15.2 C14 15.2 7 13 0 8Z"/><rect class="sw-stem" x="21" y="2.6" width="1.4" height="10.8" rx=".7"/></svg></button>`).join('');
  $('theme-name').textContent = THEMES.find((t) => t[0] === theme)?.[1] || 'Forest';
  paintSeg($('motion-seg'), readPref('lab-motion', 'full'));
  paintSeg($('mode-seg'), readMode());
}
function paintSeg(seg, value) {
  [...seg.querySelectorAll('button')].forEach((b, i) => {
    b.setAttribute('aria-pressed', String(b.dataset.v === value));
    if (b.dataset.v === value) seg.style.setProperty('--i', i);
  });
}
$('mode-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setMode(b.dataset.v);
});
window.addEventListener('lab:mode', renderAppearance);
function applyTheme(id) {
  const t = THEMES.find((x) => x[0] === id) || THEMES[0];
  document.documentElement.style.setProperty('--h', t[2]);
  document.documentElement.style.setProperty('--k', t[3]);
  writePref('lab-theme', t[0]);
  renderAppearance();
  document.querySelector(`.swatch[data-theme="${t[0]}"]`)?.focus();
}
$('swatches').addEventListener('click', (e) => {
  const sw = e.target.closest('.swatch');
  if (sw) applyTheme(sw.dataset.theme);
});
$('swatches').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const i = THEMES.findIndex((t) => t[0] === readPref('lab-theme', 'forest'));
  const by = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
  applyTheme(THEMES[(i + by + THEMES.length) % THEMES.length][0]);
});
$('motion-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.v === 'full') document.documentElement.removeAttribute('data-motion');
  else document.documentElement.setAttribute('data-motion', b.dataset.v);
  writePref('lab-motion', b.dataset.v);
  renderAppearance();
});

/* ---------- Start ---------- */
async function init() {
  mountShell({ current: 'home' });
  renderAppearance();
  showView(location.hash.slice(1) || 'home', { instant: true });
  await Promise.all([loadCatalog().catch((error) => toast(`The presets did not load: ${error.message}`, 'err')), loadState(), loadStorage()]);
  if (rerunId && S.catalog) await loadRerun(rerunId);
  if (S.catalog) renderChips();
  await poll();
  // Open the newest run job on Run, so its progress shows after a reload.
  const lastRun = S.jobs.find((j) => j.command === 'run');
  if (lastRun && !S.panels.run && (lastRun.status === 'running' || lastRun.status === 'stopping')) watch('run', lastRun.id);
  if (!S.panels.lab && S.jobs[0]) watch('lab', S.jobs[0].id);
}
init();
