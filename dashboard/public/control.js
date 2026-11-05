// Model Lab control page: Home, Run and Lab. Starts `node lab` jobs through /api/jobs and shows them.
// No framework. Text from the server goes in with textContent or esc().
import { mountShell, setCurrent, paintRunCard as shellRunCard, setNavDot, setOffline, setMode, readMode, icon, progressText } from './shell.js';
import { runProgress, jobName, jobTitle } from './js/jobwatch.js';
import { setData, contexts } from './js/model.js';
import { verdictFor, caseLabel as soleCase } from './js/summary.js';
import { keepParts } from './js/util.js';
import { testTitle, testMeta, shortDate, caseName, plural as words } from './js/words.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const svg = icon;
const plural = (n, word) => words(n, word, word === 'try' ? 'tries' : `${word}s`);
const ago = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return shortDate(iso);
};
const firstSentence = (text) => String(text || '').trim().split(/(?<=[.?!])\s/)[0];

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
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
  jobs: [],
  running: null,
  lines: new Map(), // job id -> { next, lines: [] }
  panels: { run: null, lab: null },
  view: 'home',
  fails: 0,
  sel: { exp: null, harness: '', models: new Set(), cases: new Set(), repeats: '' },
};

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
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  window.scrollTo({ top: 0, behavior: 'auto' });
}
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

/* ---------- Custom select (the real <select> keeps the value and the change events) ---------- */
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.trigger.setAttribute('aria-expanded', 'false');
  openMenu.menu.remove();
  openMenu = null;
}
function enhanceSelect(select) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'sel';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = `<span class="sel-text"></span>${svg('down')}`;
  select.after(trigger);
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  const label = document.querySelector(`label[for="${select.id}"]`);
  if (label) {
    label.addEventListener('click', (e) => {
      e.preventDefault();
      trigger.focus();
    });
    trigger.setAttribute('aria-label', label.textContent);
  }
  const paint = () => {
    const opt = select.selectedOptions[0];
    const text = trigger.querySelector('.sel-text');
    text.textContent = opt ? opt.textContent : '';
  };
  const choose = (value) => {
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    paint();
    closeMenu();
    trigger.focus();
  };
  const setActive = (i) => {
    if (!openMenu) return;
    openMenu.active = i;
    openMenu.menu.querySelectorAll('.opt').forEach((el, n) => el.classList.toggle('active', n === i));
    openMenu.menu.children[i]?.scrollIntoView({ block: 'nearest' });
  };
  const move = (by) => {
    if (!openMenu || !by) return;
    const n = select.options.length;
    setActive(Math.min(n - 1, Math.max(0, (openMenu.active ?? -1) + by)));
  };
  const open = (moveBy = 0) => {
    if (openMenu?.trigger === trigger) {
      move(moveBy);
      return;
    }
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'listbox');
    [...select.options].forEach((o, i) => {
      const el = document.createElement('div');
      el.className = 'opt';
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(o.selected));
      el.innerHTML = `<span class="opt-text"><span></span></span>${svg('check')}`;
      el.querySelector('.opt-text span').textContent = o.textContent;
      if (o.dataset.detail) el.firstChild.insertAdjacentHTML('beforeend', `<small>${esc(o.dataset.detail)}</small>`);
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => choose(o.value));
      el.addEventListener('mousemove', () => setActive(i));
      menu.append(el);
    });
    document.body.append(menu);
    openMenu = { trigger, menu, active: select.selectedIndex, place: null };
    const place = () => {
      const r = trigger.getBoundingClientRect();
      menu.style.width = `${r.width}px`;
      menu.style.left = `${r.left}px`;
      const below = innerHeight - r.bottom;
      const up = below < 260 && r.top > below;
      menu.classList.toggle('up', up);
      menu.style.top = up ? '' : `${r.bottom + 6}px`;
      menu.style.bottom = up ? `${innerHeight - r.top + 6}px` : '';
    };
    openMenu.place = place;
    place();
    trigger.setAttribute('aria-expanded', 'true');
    setActive(select.selectedIndex);
    if (moveBy) move(moveBy);
  };
  trigger.addEventListener('click', () => (openMenu?.trigger === trigger ? closeMenu() : open()));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && openMenu?.trigger === trigger) {
      e.preventDefault();
      const o = select.options[openMenu.active] || select.options[0];
      if (o) choose(o.value);
    } else if (e.key === 'Escape') closeMenu();
  });
  select.addEventListener('refresh', paint);
  paint();
}
document.addEventListener('mousedown', (e) => {
  if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.trigger.contains(e.target)) closeMenu();
});
window.addEventListener('scroll', () => openMenu?.place(), true);
window.addEventListener('resize', () => openMenu?.place());
const refreshSelect = (select) => select.dispatchEvent(new Event('refresh'));

/* ---------- Jobs ---------- */
async function startJob(body, panel) {
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
    return `${progressText(p)}${p.errors ? ` · ${plural(p.errors, 'error')}` : ''}${now ? ` · last: ${now}` : ''}`;
  }
  const answers = p.done - p.errors;
  if (job.status === 'passed') return `Done: ${plural(answers, 'answer')}${p.errors ? `, ${plural(p.errors, 'error')}` : ''}.`;
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
    const stopWord = job.status === 'stopping' ? 'Stop now' : job.command === 'run' && !job.dry_run ? 'Stop after this call' : 'Stop';
    const ctxKey = !live && p ? contextOfRun(p) : null;
    const foot = !live && p && p.done > 0
      ? `<a class="btn primary small" href="/results.html${ctxKey ? `#ctx=${encodeURIComponent(ctxKey)}` : ''}">See results</a>`
      : !live && job.dry_run ? '<p class="job-note">Preview only: nothing was called or written. Press Start run to call the models.</p>' : '';
    host.innerHTML = `<div class="job-head">${statusTag(job, { shake: host.dataset.job === id && job.status === 'failed' })}<span class="job-name"></span>${live ? `<button type="button" class="btn danger small" data-stop="${esc(id)}">${stopWord}</button>` : ''}</div>
      ${p ? '<div class="prog"><div class="progress"><i></i></div><p class="prog-text"></p></div>' : ''}
      <details class="log-box"${p ? '' : ' open'}><summary class="disclose">${p ? 'Show the log' : 'Log'}</summary><p class="job-cmd"><code></code></p><pre class="log" tabindex="0" aria-label="Log"></pre></details>
      <div class="job-foot">${foot}</div>`;
    host.querySelector('.job-name').textContent = jobTitle(job);
    host.querySelector('.job-cmd code').textContent = job.args.join(' ');
    host.dataset.job = id;
    host.dataset.status = job.status;
    host.dataset.shown = '0';
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
    if (ended.some((job) => job.command === 'run' || job.command === 'score')) await loadState();
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
    setData(S.state);
  } catch (error) {
    toast(`The results did not load: ${error.message}`, 'err');
    return;
  }
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
    if (!halt && r.status !== 'failed') continue;
    const name = r.experiment_id || r.suite?.id || 'run';
    items.push({ tone: 'warn', title: halt ? `The last ${name} run stopped` : `The last ${name} run failed`, sub: halt ? `${HALT[halt] || halt}. ${ago(r.created_at)}.` : `${r.rows} of ${r.expected_rows} answers stored, ${plural(r.errors, 'error')}. ${ago(r.created_at)}.`, href: `/results.html#ctx=${encodeURIComponent(r.context_key)}`, act: 'Open the result' });
  }
  const val = lastJob('validate');
  if (val && val.status === 'failed') items.push({ tone: 'err', title: 'Validate found problems', sub: `${ago(val.ended_at)}. Read its output on Lab.`, href: '#lab', act: 'Open Lab' });
  const doc = lastJob('doctor');
  const rows = doc ? doctorRows(doc.id) : [];
  if (rows.length && !rows.some((r) => r.ready)) items.push({ tone: 'warn', title: 'No harness is ready on this machine', sub: 'Install or sign in to a CLI, then check again.', href: '#lab', act: 'Open Lab' });
  return items;
}

function renderHome() {
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
  if (!tests) html = '<li class="row"><div class="row-text"><p>Reading the results</p></div></li>';
  else if (!tests.length) html = '<li class="row"><div class="row-text"><h3>No results yet</h3><p>Run a test. Its result shows here.</p></div><div class="row-ctl"><a class="btn secondary small" href="#run">Open Run</a></div></li>';
  else {
    html = tests.map((c) => {
      const v = verdictFor(c);
      return `<li><a class="meter" href="/results.html#ctx=${encodeURIComponent(c.key)}"><span class="meter-val"><b>${esc(testTitle(c))}</b><span class="meter-meta">${keepParts(testMeta(c, c.config_ids.length, soleCase(c)))}</span><span class="meter-say">${esc(v.sentences[0] || '')}</span></span>${svg('chev')}</a></li>`;
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

/* ---------- Run ---------- */
const currentExp = () => S.catalog?.experiments.find((e) => e.file === S.sel.exp) || null;
const caseIds = (e) => (e ? e.cases || e.case_ids || [] : []);
const harnessesOf = (e) => [...new Set((e?.targets || []).map((t) => t.harness))];

function renderRunForm() {
  const exps = S.catalog.experiments;
  const select = $('exp-select');
  select.innerHTML = '';
  for (const e of exps) {
    const o = new Option(e.id, e.file);
    o.dataset.detail = firstSentence(e.description) || [e.suite, plural(e.targets?.length || 0, 'setup')].filter(Boolean).join(' · ');
    select.append(o);
  }
  let saved = null;
  try {
    saved = localStorage.getItem('lab-exp');
  } catch {
    saved = null;
  }
  S.sel.exp = exps.some((e) => e.file === saved) ? saved : exps[0]?.file || null;
  select.value = S.sel.exp || '';
  refreshSelect(select);
  $('exp-note').textContent = plural(exps.length, 'experiment');
  pickExp();
}

function caseLabel(e, id) {
  const k = S.state?.cases?.[id];
  return caseName(id, e.suite || '', k && k.input);
}

function renderChips() {
  const e = currentExp();
  const hs = harnessesOf(e);
  $('harness-row').hidden = hs.length < 2;
  $('harness-chips').innerHTML = ['', ...hs].map((h) => `<button type="button" class="mchip" role="radio" aria-checked="${S.sel.harness === h}" data-harness="${esc(h)}">${h ? esc(h) : 'All'}</button>`).join('');
  const models = [...new Set((e?.targets || []).filter((t) => !S.sel.harness || t.harness === S.sel.harness).map((t) => t.model))];
  for (const m of [...S.sel.models]) if (!models.includes(m)) S.sel.models.delete(m);
  $('model-chips').innerHTML = models.map((m) => `<button type="button" class="mchip" aria-pressed="${S.sel.models.has(m)}" data-model="${esc(m)}">${esc(m)}</button>`).join('');
  const ids = caseIds(e);
  $('case-chips').innerHTML = ids.length ? ids.map((c) => `<button type="button" class="mchip" aria-pressed="${S.sel.cases.has(c)}" data-case="${esc(c)}" title="${esc(c)}">${esc(caseLabel(e, c))}</button>`).join('') : '<span class="chip muted">No cases found</span>';
}

function pickExp() {
  const e = currentExp();
  S.sel.harness = '';
  S.sel.models = new Set();
  S.sel.cases = new Set();
  S.sel.repeats = '';
  const detail = $('exp-detail');
  detail.hidden = false; // empty until the catalog arrives
  if (!e) {
    detail.innerHTML = '<div class="row-text"><p>No experiments in experiments/.</p></div>';
    renderChips();
    countCalls();
    return;
  }
  const chips = [
    e.suite ? `<span class="chip muted">test ${esc(e.suite)}</span>` : '',
    `<span class="chip muted">${esc(plural(caseIds(e).length, 'case'))}</span>`,
    `<span class="chip muted">${esc(e.repeats > 1 ? `${e.repeats} tries each` : '1 try')}</span>`,
    e.access === 'edit' ? '<span class="chip warn">agent task: edits files</span>' : '',
    `<span class="chip muted">user setup ${e.user_config === 'isolated' ? 'kept out' : 'loaded'}</span>`,
  ].join('');
  const targets = (e.targets || []).map((t) => `<div class="target"><span class="mark-s"></span><b>${esc(t.model)}</b><span>through ${esc(t.harness)}${t.effort ? ` · effort ${esc(t.effort)}` : ''}</span></div>`).join('');
  const problems = e.problems.length ? `<div class="notice warn">${e.problems.map(esc).join('<br>')}</div>` : '';
  detail.innerHTML = `${e.description ? '<p class="exp-desc"></p>' : ''}<div class="chip-row">${chips}</div><div class="targets" aria-label="Setups">${targets}</div>${problems}`;
  if (e.description) detail.querySelector('.exp-desc').textContent = e.description;
  $('repeats').value = '';
  $('repeats').placeholder = String(e.repeats);
  $('edit-notice').hidden = e.access !== 'edit';
  renderChips();
  countCalls();
}

function chosenTargets() {
  const e = currentExp();
  if (!e) return [];
  return (e.targets || []).filter((t) => (!S.sel.harness || t.harness === S.sel.harness) && (!S.sel.models.size || S.sel.models.has(t.model)));
}
const repeatsOk = () => S.sel.repeats === '' || (Number.isInteger(Number(S.sel.repeats)) && Number(S.sel.repeats) >= 1 && Number(S.sel.repeats) <= 50);

function countCalls() {
  const e = currentExp();
  if (!e) {
    $('plan-n').textContent = '0';
    syncRunButtons();
    return 0;
  }
  const cases = S.sel.cases.size || caseIds(e).length;
  const repeats = S.sel.repeats === '' ? e.repeats || 1 : Number(S.sel.repeats);
  const targets = chosenTargets().length;
  const calls = targets * cases * repeats;
  const ok = repeatsOk() && targets > 0;
  $('plan-n').textContent = ok ? String(calls) : '0';
  $('plan-word').textContent = ok && calls === 1 ? 'call' : 'calls';
  $('plan-break').innerHTML = [['Setups', targets], ['Cases', cases], ['Tries per case', ok ? repeats : '–']]
    .map(([k, v]) => `<dt>${k}</dt><dd class="num">${esc(v)}</dd>`).join('');
  $('call-count').classList.toggle('bad', !ok);
  $('call-count').textContent = !repeatsOk()
    ? 'Tries must be a whole number from 1 to 50.'
    : targets
      ? `${plural(targets, 'setup')} × ${plural(cases, 'case')} × ${plural(repeats, 'try')} = ${plural(calls, 'call')}.`
      : 'No setup matches this harness and these models.';
  const parts = [S.sel.harness ? `${S.sel.harness} only` : '', S.sel.models.size ? plural(S.sel.models.size, 'model') : '', S.sel.cases.size ? plural(S.sel.cases.size, 'case') : '', S.sel.repeats ? plural(Number(S.sel.repeats) || 0, 'try') : ''].filter(Boolean);
  $('narrow-sum').textContent = parts.length ? parts.join(' · ') : 'Everything in the experiment';
  $('repeats-hint').textContent = repeats < 3 ? 'Use 3 or more to compare setups. Fewer is fine for a first look.' : 'Enough tries to compare setups.';
  disarm();
  syncRunButtons();
  return calls;
}
function syncRunButtons() {
  const none = !chosenTargets().length || !repeatsOk();
  $('start-btn').disabled = none || Boolean(S.running);
  $('preview-btn').disabled = none || Boolean(S.running);
  $('start-btn').title = S.running ? 'Wait for the current job to end.' : '';
}
$('exp-select').addEventListener('change', (e) => {
  S.sel.exp = e.target.value;
  try {
    localStorage.setItem('lab-exp', S.sel.exp);
  } catch {
    // Not saved.
  }
  pickExp();
});
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.mchip');
  if (!chip) return;
  if (chip.dataset.harness !== undefined) {
    S.sel.harness = chip.dataset.harness;
    renderChips();
    $('harness-chips').querySelector(`[data-harness="${CSS.escape(S.sel.harness)}"]`)?.focus();
  } else {
    const on = chip.getAttribute('aria-pressed') !== 'true';
    chip.setAttribute('aria-pressed', String(on));
    const set = chip.dataset.model ? S.sel.models : S.sel.cases;
    const key = chip.dataset.model || chip.dataset.case;
    if (on) set.add(key);
    else set.delete(key);
  }
  countCalls();
});
$('repeats').addEventListener('input', (e) => {
  S.sel.repeats = e.target.value.trim();
  countCalls();
});
function runBody(dry) {
  const e = currentExp();
  const body = { command: 'run', experiment: e.file, dry_run: dry };
  if (S.sel.harness) body.harness = S.sel.harness;
  if (S.sel.models.size) body.models = [...S.sel.models];
  if (S.sel.cases.size) body.cases = [...S.sel.cases];
  if (S.sel.repeats) body.repeats = Number(S.sel.repeats);
  return body;
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
    $('run-output-note').textContent = 'Live: the models are called through your sign-ins';
    showOutput();
  }
});

/* ---------- Lab ---------- */
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
  const id = S.panels.lab;
  const job = id && S.jobs.find((j) => j.id === id);
  $('lab-output-note').textContent = job ? ago(job.started_at) : '';
}

const showLabOutput = () => {
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
  if (job) renderHarnesses();
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
  document.querySelectorAll('select[data-custom]').forEach(enhanceSelect);
  mountShell({ current: 'home' });
  renderAppearance();
  showView(location.hash.slice(1) || 'home', { instant: true });
  await Promise.all([loadCatalog().catch((error) => toast(`The experiments did not load: ${error.message}`, 'err')), loadState()]);
  if (S.catalog) renderChips();
  await poll();
  // Open the newest run job on Run, so its progress shows after a reload.
  const lastRun = S.jobs.find((j) => j.command === 'run');
  if (lastRun && !S.panels.run && (lastRun.status === 'running' || lastRun.status === 'stopping')) watch('run', lastRun.id);
  if (!S.panels.lab && S.jobs[0]) watch('lab', S.jobs[0].id);
}
init();
