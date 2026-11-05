// Model Lab control page: starts `node lab` jobs through /api/jobs and shows their output.
// No framework. Text from the server goes in with textContent or esc().

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const svg = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ago = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

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
  panels: { run: null, checks: null, activity: null, harnesses: null },
  view: 'home',
  fails: 0,
  compareStale: true,
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
const VIEWS = ['home', 'run', 'runs', 'compare', 'harnesses', 'checks', 'activity', 'appearance'];
function moveNavPill(instant) {
  const pill = document.querySelector('.nav-pill');
  const active = document.querySelector('.nav-item[aria-current="true"]');
  if (!pill || !active) return;
  if (instant) pill.style.transition = 'none';
  pill.style.height = `${active.offsetHeight}px`;
  pill.style.width = `${active.offsetWidth}px`;
  pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  if (instant) {
    void pill.offsetWidth;
    pill.style.transition = '';
  }
}
function showView(name, { instant = false } = {}) {
  if (!VIEWS.includes(name)) name = 'home';
  S.view = name;
  for (const v of VIEWS) $(`view-${v}`).classList.toggle('active', v === name);
  document.querySelectorAll('.nav-item').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === name)));
  moveNavPill(instant);
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (name === 'compare') {
    const frame = $('compare-frame');
    if (S.compareStale || !frame.src) {
      frame.src = frame.dataset.src;
      S.compareStale = false;
    }
  }
}
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) showView(go.dataset.go);
  const nav = e.target.closest('.nav-item');
  if (nav) showView(nav.dataset.view);
});
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
window.addEventListener('resize', () => moveNavPill(true));

/* ---------- Custom select (real <select> stays for value and change events) ---------- */
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
    if (opt?.dataset.detail) text.insertAdjacentHTML('beforeend', `<small>${esc(opt.dataset.detail)}</small>`);
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
      el.dataset.value = o.value;
      el.dataset.index = i;
      el.innerHTML = `<span class="opt-text"></span>${svg('check')}`;
      el.firstChild.textContent = o.textContent;
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
      const up = below < 220 && r.top > below;
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
    paintRunCard();
    schedule(200);
    return job;
  } catch (error) {
    if (error.status === 409 && error.data?.job) {
      toast(`A job is running: ${error.data.job.label}. Stop it on Activity, or wait.`, 'warn');
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
  pullLines(id).then(() => renderPanel(panel));
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
const lineClass = (line) => (/^\s*(Error|error:)|failed|left_workdir|FAIL/.test(line) ? 'l-err' : /All inputs and records are valid|completed|Dry run:|passed|ready/.test(line) ? 'l-ok' : /warn|skipped|Stopping|not found/i.test(line) ? 'l-warn' : '');
const STATUS = {
  running: ['', 'Running'],
  stopping: ['warn', 'Stopping after the current call'],
  passed: ['ok', 'Finished'],
  failed: ['err', 'Failed'],
  stopped: ['warn', 'Stopped'],
};
function statusTag(job, { shake = false } = {}) {
  const [tone, word] = STATUS[job.status] || ['', job.status];
  const icon = job.status === 'passed' ? '<svg class="i check-pop" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>' : job.status === 'running' || job.status === 'stopping' ? '<span class="spinner"></span>' : '';
  const code = job.exit_code != null && job.status === 'failed' ? ` (exit ${job.exit_code})` : '';
  return `<span class="tag ${tone}${shake ? ' shake' : ''}">${icon}${esc(word + code)}</span>`;
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
  if (host.dataset.job !== id || host.dataset.status !== job.status) {
    const stopWord = job.status === 'stopping' ? 'Stop now' : job.command === 'run' && !job.dry_run ? 'Stop after this call' : 'Stop';
    host.innerHTML = `<div class="job-head">${statusTag(job, { shake: host.dataset.job === id && job.status === 'failed' })}<code></code>${live ? `<button type="button" class="btn danger small" data-stop="${esc(id)}">${stopWord}</button>` : ''}</div><pre class="log" tabindex="0" aria-label="Output"></pre><div class="job-foot"></div>`;
    host.querySelector('code').textContent = job.args.join(' ');
    host.dataset.job = id;
    host.dataset.status = job.status;
    host.dataset.shown = '0';
    if (!live && job.command === 'run' && !job.dry_run) host.querySelector('.job-foot').innerHTML = '<button type="button" class="btn secondary small" data-go="compare">Open Compare</button><button type="button" class="btn tertiary small" data-go="runs">See runs</button>';
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
document.addEventListener('click', async (e) => {
  const stop = e.target.closest('[data-stop]');
  if (!stop) return;
  stop.disabled = true;
  try {
    const { job } = await api('POST', `/api/jobs/${encodeURIComponent(stop.dataset.stop)}/cancel`, {});
    upsertJob(job);
    renderAllPanels();
    schedule(200);
  } catch (error) {
    toast(error.message, 'err');
  }
});
const renderAllPanels = () => Object.keys(S.panels).forEach(renderPanel);

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
    $('offline').hidden = true;
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
    for (const job of S.jobs) {
      const was = before.get(job.id);
      if ((was === 'running' || was === 'stopping') && job.status !== was) finished(job);
    }
    renderAllPanels();
    paintRunCard();
    syncRunButtons();
    renderActivity();
    renderMeters();
  } catch {
    S.fails += 1;
    if (S.fails >= 2) {
      $('offline').hidden = false;
      paintRunCard(true);
    }
  }
  polling = false;
  schedule(document.hidden ? 60000 : S.running ? 1000 : 4000);
}
document.addEventListener('visibilitychange', () => !document.hidden && schedule(0));

function finished(job) {
  const word = { passed: 'finished', failed: 'failed', stopped: 'was stopped' }[job.status] || job.status;
  toast(`${job.label} ${word}.`, job.status === 'passed' ? 'ok' : job.status === 'failed' ? 'err' : 'warn');
  if (job.command === 'run' || job.command === 'score') {
    S.compareStale = true;
    loadState();
  }
  if (job.command === 'doctor') renderHarnesses();
  renderCheckTags();
}

/* ---------- Run card ---------- */
function paintRunCard(offline = false) {
  const card = $('run-card');
  const set = (tone, title, sub) => {
    card.dataset.tone = tone;
    $('run-title').textContent = title;
    $('run-sub').textContent = sub;
  };
  const job = S.jobs.find((j) => j.id === S.running);
  if (offline) set('stopped', 'Server stopped', 'Run node lab dashboard');
  else if (job?.status === 'stopping') set('starting', 'Stopping', 'After the current call');
  else if (job) set('ready', job.dry_run ? 'Previewing' : 'Running', job.label);
  else {
    const last = S.jobs[0];
    set('idle', 'Ready', last ? `Last: ${last.command} ${STATUS[last.status]?.[1].toLowerCase() || last.status}` : 'No job running');
  }
  document.querySelector('.nav-item[data-view="activity"] .nav-dot').className = `nav-dot${job ? ' busy' : ''}`;
}

/* ---------- Data ---------- */
async function loadCatalog() {
  S.catalog = await api('GET', '/api/catalog');
  renderRunForm();
  renderHarnesses();
  renderMeters();
}
async function loadState() {
  try {
    S.state = await api('GET', '/api/state');
  } catch (error) {
    toast(`Could not read the runs: ${error.message}`, 'err');
    return;
  }
  renderRuns();
  renderMeters();
}

/* ---------- Home ---------- */
function lastJob(command) {
  return S.jobs.find((j) => j.command === command && !(j.status === 'running' || j.status === 'stopping'));
}
function doctorRows(id) {
  const lines = S.lines.get(id)?.lines || [];
  return lines.map((l) => /^(\S+)\s+(built-in|declared)\s+(ready|not found)\s+(partial|none)\s+(.*)$/.exec(l)).filter(Boolean)
    .map((m) => ({ name: m[1], source: m[2], ready: m[3] === 'ready', isolation: m[4], detail: m[5].trim() }));
}
function renderMeters() {
  const ul = $('meters');
  if (!ul) return;
  const exps = S.catalog?.experiments || [];
  const runs = S.state?.runs || [];
  const latest = runs[0];
  const doc = lastJob('doctor');
  const docRows = doc ? doctorRows(doc.id) : [];
  const val = lastJob('validate');
  const running = S.jobs.find((j) => j.id === S.running);
  const meters = [
    ['run', 'Experiments', plural(exps.length, 'experiment'), exps.slice(0, 4).map((e) => e.id).join(', ') || 'Add one in experiments/', exps.length ? 'ok' : 'warn'],
    ['runs', 'Runs', plural(runs.length, 'run'), latest ? `Latest: ${latest.experiment_id || latest.suite?.id || latest.run_id} · ${latest.status} · ${ago(latest.created_at)}` : 'No runs yet', latest && latest.status !== 'completed' ? 'warn' : runs.length ? 'ok' : ''],
    ['harnesses', 'Harnesses', docRows.length ? `${docRows.filter((r) => r.ready).length} of ${docRows.length} ready` : `${S.catalog?.harnesses.length || 0} harnesses`, docRows.length ? docRows.filter((r) => r.ready).map((r) => r.name).join(', ') || 'None installed' : 'Not checked yet', docRows.length ? (docRows.some((r) => r.ready) ? 'ok' : 'warn') : 'info'],
    ['checks', 'Checks', val ? (val.status === 'passed' ? 'Valid' : 'Problems found') : 'Not run yet', val ? `node lab validate · ${ago(val.ended_at)}` : 'Validate inputs and records', val ? (val.status === 'passed' ? 'ok' : 'warn') : 'info'],
    ['activity', 'Activity', running ? (running.dry_run ? 'Previewing' : 'Running') : 'Idle', running ? running.label : S.jobs[0] ? `Last: ${S.jobs[0].label}` : 'No jobs yet', running ? 'ok' : ''],
  ];
  const html = meters.map(([view, label, value, sub, tone]) => `<li><button type="button" class="meter" data-go="${view}"><span class="meter-label">${label}</span><span class="meter-val"><b>${esc(value)}</b><span>${esc(sub)}</span></span><span class="mark-s ${tone}" aria-hidden="true"></span>${svg('chev')}</button></li>`).join('');
  if (ul.dataset.html !== html) {
    ul.innerHTML = html;
    ul.dataset.html = html;
  }
  for (const [view, , , , tone] of meters) {
    const dot = document.querySelector(`.nav-item[data-view="${view}"] .nav-dot`);
    if (dot && view !== 'activity') dot.className = `nav-dot${tone === 'warn' ? ' warn' : ''}`;
  }
  $('hero-title').textContent = running ? (running.dry_run ? 'Previewing a run' : 'A job is running') : 'Ready to run';
  $('hero-sub').textContent = `${plural(exps.length, 'experiment')} · ${plural(runs.length, 'stored run')}${S.catalog ? ` · ${plural(S.catalog.models.length, 'model')} in the registry` : ''}`;
}

/* ---------- Run page ---------- */
function currentExp() {
  return S.catalog?.experiments.find((e) => e.file === S.sel.exp) || null;
}
function renderRunForm() {
  const exps = S.catalog.experiments;
  const select = $('exp-select');
  select.innerHTML = '';
  for (const e of exps) {
    const o = new Option(e.id, e.file);
    o.dataset.detail = [e.suite, plural(e.targets?.length || 0, 'target')].filter(Boolean).join(' · ');
    select.append(o);
  }
  const saved = (() => {
    try {
      return localStorage.getItem('lab-exp');
    } catch {
      return null;
    }
  })();
  S.sel.exp = exps.some((e) => e.file === saved) ? saved : exps.find((e) => e.file === 'opencode-reasoning.yaml')?.file || exps[0]?.file || null;
  select.value = S.sel.exp || '';
  refreshSelect(select);
  $('exp-note').textContent = plural(exps.length, 'experiment');
  pickExp();
}
function pickExp() {
  const e = currentExp();
  S.sel.harness = '';
  S.sel.models = new Set();
  S.sel.cases = new Set();
  S.sel.repeats = '';
  const detail = $('exp-detail');
  if (!e) {
    detail.innerHTML = '<div class="row-text"><p>No experiments in experiments/.</p></div>';
    return;
  }
  const chips = [
    `<span class="chip muted">suite ${esc(e.suite)}</span>`,
    `<span class="chip muted">prompt ${esc(e.prompt)}</span>`,
    `<span class="chip muted">${esc(plural(e.repeats, 'repeat'))}</span>`,
    e.access === 'edit' ? '<span class="chip warn">agent task: edit access</span>' : '',
    `<span class="chip ${e.user_config === 'isolated' ? '' : 'muted'}">user setup ${esc(e.user_config)}</span>`,
  ].join('');
  const targets = (e.targets || []).map((t) => `<div class="target"><span class="mark-s"></span><b>${esc(t.model)}</b> through ${esc(t.harness)}${t.effort ? ` · effort ${esc(t.effort)}` : ''}</div>`).join('');
  const problems = e.problems.length ? `<div class="notice warn">${e.problems.map(esc).join('<br>')}</div>` : '';
  detail.innerHTML = `${e.description ? `<p class="exp-desc"></p>` : ''}<div class="chip-row">${chips}</div><div class="targets">${targets}</div>${problems}`;
  if (e.description) detail.querySelector('.exp-desc').textContent = e.description;
  const hs = [...new Set((e.targets || []).map((t) => t.harness))];
  const hsel = $('harness-select');
  hsel.innerHTML = '';
  hsel.append(new Option('All harnesses in this experiment', ''));
  for (const h of hs) hsel.append(new Option(h, h));
  hsel.value = '';
  refreshSelect(hsel);
  $('model-chips').innerHTML = [...new Set((e.targets || []).map((t) => t.model))].map((m) => `<button type="button" class="mchip" aria-pressed="false" data-model="${esc(m)}">${esc(m)}</button>`).join('');
  const caseIds = e.cases || e.case_ids || [];
  $('case-chips').innerHTML = caseIds.length ? caseIds.map((c) => `<button type="button" class="mchip" aria-pressed="false" data-case="${esc(c)}">${esc(c.replace(`${e.suite}-`, ''))}</button>`).join('') : '<span class="chip muted">No cases found</span>';
  $('repeats').value = '';
  $('repeats').placeholder = String(e.repeats);
  $('edit-notice').hidden = e.access !== 'edit';
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
  if (!e) return 0;
  const cases = S.sel.cases.size || (e.cases || e.case_ids || []).length;
  const repeats = S.sel.repeats === '' ? e.repeats || 1 : Number(S.sel.repeats);
  const targets = chosenTargets().length;
  const calls = targets * cases * repeats;
  $('call-count').textContent = !repeatsOk()
    ? 'Repeats must be a whole number from 1 to 50.'
    : targets
    ? `This run makes ${plural(calls, 'call')}: ${plural(targets, 'target')} × ${plural(cases, 'case')} × ${plural(repeats, 'repeat')}.`
    : 'No target matches this harness and these models.';
  disarm();
  syncRunButtons();
  return calls;
}
function syncRunButtons() {
  const none = !chosenTargets().length || !repeatsOk();
  $('start-btn').disabled = none || Boolean(S.running);
  $('preview-btn').disabled = none || Boolean(S.running);
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
$('harness-select').addEventListener('change', (e) => {
  S.sel.harness = e.target.value;
  countCalls();
});
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.mchip');
  if (!chip) return;
  const on = chip.getAttribute('aria-pressed') !== 'true';
  chip.setAttribute('aria-pressed', String(on));
  const set = chip.dataset.model ? S.sel.models : S.sel.cases;
  const key = chip.dataset.model || chip.dataset.case;
  if (on) set.add(key);
  else set.delete(key);
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
$('preview-btn').addEventListener('click', async () => {
  const job = await startJob(runBody(true), 'run');
  if (job) $('run-output-note').textContent = 'Preview: nothing is called or written';
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
    b.textContent = `Start ${plural(calls, 'call')}${e.access === 'edit' ? ' with edit access' : ''}?`;
    armTimer = setTimeout(disarm, 5000);
    return;
  }
  disarm();
  b.disabled = true;
  b.innerHTML = '<span class="spinner"></span>Starting';
  const job = await startJob(runBody(false), 'run');
  b.textContent = 'Start run';
  countCalls();
  if (job) $('run-output-note').textContent = 'Live: models are called through your sign-ins';
});

/* ---------- Runs page ---------- */
function renderRuns() {
  const runs = S.state?.runs || [];
  $('runs-note').textContent = plural(runs.length, 'run');
  if (!runs.length) {
    $('runs-list').innerHTML = '<li class="row"><div class="row-text"><h3>No runs yet</h3><p>Start one on the Run page.</p></div><div class="row-ctl"><button type="button" class="btn secondary small" data-go="run">Open Run</button></div></li>';
    return;
  }
  $('runs-list').innerHTML = runs.map((r) => {
    const halted = r.harness?.settings?.halted;
    const stale = r.liveness === 'stale';
    const tone = r.status === 'completed' ? '' : r.status === 'running' && !stale ? 'muted' : 'warn';
    const harness = r.harness ? `${r.harness.name} ${r.harness.version || ''}`.trim() : 'unknown harness';
    const errs = r.errors ? ` · ${plural(r.errors, 'error')}` : '';
    return `<li class="row"><div class="row-text"><h3>${esc(r.experiment_id || r.suite?.id || 'run')} <span class="chip ${tone}">${esc(stale ? 'stopped without finishing' : r.status)}</span>${halted ? '<span class="chip warn">stopped by the guard</span>' : ''}</h3>
      <p>${esc(harness)} · ${esc(r.models.join(', '))} · ${r.rows}/${r.expected_rows} rows${errs} · ${esc(ago(r.created_at))}</p><p class="mono">${esc(r.run_id)}</p></div>
      <div class="row-ctl">${r.resumable ? `<button type="button" class="btn primary small" data-resume="${esc(r.run_id)}">Resume</button>` : ''}${halted ? `<button type="button" class="btn danger small" data-score="${esc(r.run_id)}" data-force="1">Score anyway</button>` : `<button type="button" class="btn secondary small" data-score="${esc(r.run_id)}">Score again</button>`}</div></li>`;
  }).join('');
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-score]');
  if (!b) return;
  if (b.dataset.force && !b.classList.contains('armed')) {
    b.classList.add('armed');
    b.textContent = 'Score a stopped run?';
    setTimeout(() => {
      b.classList.remove('armed');
      b.textContent = 'Score anyway';
    }, 5000);
    return;
  }
  const job = await startJob({ command: 'score', run_ids: [b.dataset.score], force: Boolean(b.dataset.force) }, 'activity');
  if (job) showView('activity');
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-resume]');
  if (!b) return;
  const job = await startJob({ command: 'run', resume: b.dataset.resume }, 'activity');
  if (job) showView('activity');
});
$('score-all').addEventListener('click', async () => {
  const job = await startJob({ command: 'score', all: true }, 'activity');
  if (job) showView('activity');
});

/* ---------- Harnesses ---------- */
function renderHarnesses() {
  const doc = lastJob('doctor');
  const rows = doc ? doctorRows(doc.id) : [];
  const list = $('harness-list');
  if (rows.length) {
    $('harness-note').textContent = `${rows.filter((r) => r.ready).length} of ${rows.length} ready · ${ago(doc.ended_at)}`;
    list.innerHTML = rows.map((r) => `<li class="row"><span class="mark-s ${r.ready ? 'ok' : 'warn'}" aria-hidden="true"></span><div class="row-text"><h3>${esc(r.name)} <span class="chip muted">${esc(r.source)}</span></h3><p>${esc(r.ready ? r.detail : `Not found. ${r.detail}`)}</p></div>
      <div class="row-ctl"><span class="chip ${r.isolation === 'partial' ? '' : 'muted'}">isolation ${esc(r.isolation)}</span><span class="sr">${r.ready ? 'Ready' : 'Not found'}</span></div></li>`).join('');
    return;
  }
  // Another panel may hold an empty cache for this job, so compare line counts.
  if (doc && (S.lines.get(doc.id)?.next ?? 0) < doc.lines) {
    pullLines(doc.id).then(() => {
      renderHarnesses();
      renderMeters();
    }).catch(() => {});
  }
  $('harness-note').textContent = doc ? 'Reading the last check' : 'Not checked yet';
  list.innerHTML = (S.catalog?.harnesses || []).map((h) => `<li class="row"><span class="mark-s" aria-hidden="true"></span><div class="row-text"><h3>${esc(h.name)} <span class="chip muted">${h.declared ? 'declared' : 'built-in'}</span></h3><p>Not checked yet</p></div></li>`).join('');
}
$('doctor-btn').addEventListener('click', async () => {
  const b = $('doctor-btn');
  b.disabled = true;
  b.innerHTML = '<span class="spinner"></span>Checking';
  const job = await startJob({ command: 'doctor' }, 'harnesses');
  const wait = setInterval(() => {
    const j = S.jobs.find((x) => x.id === job?.id);
    if (!job || (j && j.status !== 'running')) {
      clearInterval(wait);
      b.disabled = false;
      b.textContent = 'Check harnesses';
      renderHarnesses();
      renderMeters();
    }
  }, 300);
});

/* ---------- Checks ---------- */
function renderCheckTags() {
  for (const cmd of ['validate', 'report', 'runs']) {
    const tag = $(`${cmd}-tag`);
    const j = S.jobs.find((x) => x.command === cmd);
    if (!j) continue;
    tag.hidden = false;
    tag.outerHTML = statusTag(j).replace('<span class="tag', `<span id="${cmd}-tag" class="tag`);
  }
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-job]');
  if (!b) return;
  await startJob({ command: b.dataset.job }, 'checks');
  renderCheckTags();
});

/* ---------- Activity ---------- */
function renderActivity() {
  const ul = $('jobs-list');
  $('jobs-note').textContent = S.jobs.length ? plural(S.jobs.length, 'job') : '';
  const html = S.jobs.length
    ? S.jobs.map((j) => `<li><button type="button" class="meter" data-show-job="${esc(j.id)}"><span class="meter-val"><b>${esc(j.label)}</b><span>${esc(ago(j.started_at))}${j.dry_run ? ' · preview' : ''}</span></span>${statusTag(j)}${svg('chev')}</button></li>`).join('')
    : '<li class="row"><div class="row-text"><h3>No jobs yet</h3><p>Jobs you start on Run, Runs, Harnesses or Checks show here.</p></div></li>';
  if (ul.dataset.html !== html) {
    ul.innerHTML = html;
    ul.dataset.html = html;
  }
  if (!S.panels.activity && S.jobs[0]) watch('activity', S.jobs[0].id);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-show-job]');
  if (b) watch('activity', b.dataset.showJob);
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
  const motion = readPref('lab-motion', 'full');
  const seg = $('motion-seg');
  const buttons = [...seg.querySelectorAll('button')];
  buttons.forEach((b, i) => {
    b.setAttribute('aria-pressed', String(b.dataset.v === motion));
    if (b.dataset.v === motion) seg.style.setProperty('--i', i);
  });
}
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
  renderAppearance();
  showView(location.hash.slice(1) || 'home', { instant: true });
  document.fonts?.ready.then(() => moveNavPill(true));
  try {
    const health = await api('GET', '/api/health');
    $('root-name').textContent = health.root;
    if (health.version) $('version').textContent = `v${health.version}`;
  } catch {
    // The poll reports offline.
  }
  await Promise.all([loadCatalog().catch((error) => toast(`Could not read the experiments: ${error.message}`, 'err')), loadState()]);
  await poll();
  renderCheckTags();
  renderHarnesses();
}
init();
