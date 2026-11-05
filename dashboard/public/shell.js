// The shell both pages share: the rail (brand, run card, page links with the sliding pill),
// the light and dark switch, and, for pages that ask, a quiet poll of the job list.
// Text from the server goes in with textContent.
import { finishedJobs, runProgress, emptyProgress, jobName } from './js/jobwatch.js';

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  run: '<path d="M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5z"/>',
  results: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  lab: '<path d="M9 3h6M10 3v6.2L4.6 18.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3"/><path d="M7.2 14h9.6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
};

// Four pages. Home, Run and Lab are views of `/`; Results is its own page.
const PAGES = [
  ['home', 'Home', '/#home', 'home'],
  ['run', 'Run', '/#run', 'run'],
  ['results', 'Results', '/results.html', 'results'],
  ['lab', 'Lab', '/#lab', 'lab'],
];

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const dark = window.matchMedia('(prefers-color-scheme: dark)');

function sprite() {
  if ($('lab-icons')) return;
  const box = document.createElement('div');
  box.innerHTML = `<svg id="lab-icons" width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(ICONS).map(([k, d]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${d}</symbol>`).join('')}</svg>`;
  document.body.prepend(box.firstChild);
}
export const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/* ---------- Light and dark ---------- */
// 'light' or 'dark' is saved under 'theme'; nothing saved means the system setting.
export function readMode() {
  try {
    const m = localStorage.getItem('theme');
    return m === 'light' || m === 'dark' ? m : 'system';
  } catch {
    // Storage blocked: the attribute set by setMode is the only record of the choice.
    const a = root.getAttribute('data-theme');
    return a === 'light' || a === 'dark' ? a : 'system';
  }
}
const shownMode = () => root.getAttribute('data-theme') || (dark.matches ? 'dark' : 'light');
export function setMode(mode) {
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
  else root.removeAttribute('data-theme');
  try {
    if (mode === 'light' || mode === 'dark') localStorage.setItem('theme', mode);
    else localStorage.removeItem('theme');
  } catch {
    // Not saved: this page keeps the choice until it reloads.
  }
  paintMode();
  window.dispatchEvent(new CustomEvent('lab:mode', { detail: { mode, shown: shownMode() } }));
}
function paintMode() {
  const btn = $('theme-toggle');
  if (!btn) return;
  const next = shownMode() === 'dark' ? 'light' : 'dark';
  btn.querySelector('.mode-word').textContent = next === 'dark' ? 'Dark mode' : 'Light mode';
  btn.querySelector('use').setAttribute('href', `#i-${next === 'dark' ? 'moon' : 'sun'}`);
  btn.setAttribute('aria-label', `Switch to ${next} mode`);
  btn.title = `Switch to ${next} mode`;
}

/* ---------- Rail ---------- */
export function mountShell({ current = 'home' } = {}) {
  sprite();
  const rail = $('rail');
  rail.innerHTML = `
    <a class="brand" href="/#home" aria-label="Model Lab home">
      <svg class="brand-mark" viewBox="0 0 26 26" aria-hidden="true"><rect x="3" y="12" width="4" height="10" rx="2"/><rect x="11" y="4" width="4" height="18" rx="2"/><rect x="19" y="8" width="4" height="14" rx="2"/></svg>
      <span class="word">model lab<span class="dot">.</span></span>
      <span class="ver" id="version"></span>
    </a>
    <a class="run-card" id="run-card" href="/#lab" data-tone="unknown" aria-live="polite">
      <span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
      <span class="run-text"><span class="run-title" id="run-title">Checking the lab</span><span class="run-sub" id="run-sub">One moment</span></span>
    </a>
    <nav class="nav" aria-label="Pages">
      <span class="nav-pill" aria-hidden="true"></span>
      ${PAGES.map(([id, label, href, ic]) => `<a class="nav-item" href="${href}" data-view="${id}" title="${label}">${icon(ic)}<span class="nav-label">${label}</span><span class="nav-dot"></span></a>`).join('')}
    </nav>
    <div class="rail-foot">
      <button type="button" class="mode-btn" id="theme-toggle">${icon('moon')}<span class="mode-word">Dark mode</span></button>
      <p>Same as <code>node lab</code> in a terminal. Data root: <code id="root-name">…</code></p>
    </div>`;
  $('theme-toggle').addEventListener('click', () => setMode(shownMode() === 'dark' ? 'light' : 'dark'));
  if (dark.addEventListener) dark.addEventListener('change', () => {
    if (root.getAttribute('data-theme')) return;
    paintMode();
    window.dispatchEvent(new CustomEvent('lab:mode', { detail: { mode: 'system', shown: shownMode() } }));
  });
  paintMode();
  setCurrent(current, { instant: true });
  window.addEventListener('resize', () => movePill(true));
  document.fonts?.ready.then(() => movePill(true));
  fetch('/api/health').then((r) => r.json()).then((h) => {
    $('root-name').textContent = h.root || '';
    if (h.version) $('version').textContent = `v${h.version}`;
  }).catch(() => {});
}

function movePill(instant) {
  const pill = document.querySelector('.nav-pill');
  const active = document.querySelector('.nav-item[aria-current="page"]');
  if (!pill) return;
  pill.classList.toggle('on', Boolean(active));
  if (!active) return;
  if (instant) pill.style.transition = 'none';
  pill.style.height = `${active.offsetHeight}px`;
  pill.style.width = `${active.offsetWidth}px`;
  pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  if (instant) {
    void pill.offsetWidth;
    pill.style.transition = '';
  }
}
export function setCurrent(view, { instant = false } = {}) {
  document.querySelectorAll('.nav-item').forEach((a) => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  movePill(instant);
}
export function setNavDot(view, cls = '') {
  const dot = document.querySelector(`.nav-item[data-view="${view}"] .nav-dot`);
  if (dot) dot.className = `nav-dot${cls ? ` ${cls}` : ''}`;
}

/* ---------- Run card ---------- */
// One line for the job that runs now, or the last one. A click opens its output:
// a run on the Run page, anything else on Lab.
const WORD = { running: 'running', stopping: 'stopping', passed: 'finished', failed: 'failed', stopped: 'stopped' };
export const progressText = (p) => (p && p.total ? `${p.done} of ${p.total} calls` : '');
export function paintRunCard({ jobs = [], running = null, offline = false, progress = null } = {}) {
  const card = $('run-card');
  if (!card) return;
  const set = (tone, title, sub) => {
    card.dataset.tone = tone;
    $('run-title').textContent = title;
    $('run-sub').textContent = sub;
  };
  const job = jobs.find((j) => j.id === running);
  const shown = job || jobs[0];
  card.href = shown && shown.command === 'run' ? '/#run' : '/#lab';
  card.title = shown ? `Open the output of the ${jobName(shown)}` : 'Open Lab';
  if (offline) set('stopped', 'Server stopped', 'Run node lab dashboard');
  else if (job?.status === 'stopping') set('starting', 'Stopping', 'After the current call');
  else if (job) set('ready', job.dry_run ? 'Previewing' : 'Running', progressText(progress) || jobName(job));
  else set('idle', 'Ready', shown ? `Last: ${jobName(shown)} ${WORD[shown.status] || shown.status}` : 'No job running');
  setNavDot('run', job && job.command === 'run' ? 'busy' : '');
}

/* ---------- Offline banner ---------- */
export function setOffline(on) {
  let el = $('offline');
  if (!el && on) {
    el = document.createElement('div');
    el.className = 'offline';
    el.id = 'offline';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="ring"></span><span>The lab server stopped. Start it again with <code>node lab dashboard</code>.</span>';
    document.body.append(el);
  }
  if (el) el.hidden = !on;
}

/* ---------- Job watch, for pages that do not run jobs themselves ---------- */
// Paints the run card, fires `lab:jobs` with every list, `lab:progress` while a run goes,
// and `lab:job-finished` with the job when one ends.
export function watchJobs() {
  let before = null;
  let fails = 0;
  let timer = null;
  let busy = false;
  const seen = new Map(); // run job id -> { next, progress }
  const progressOf = async (job) => {
    if (!job || job.command !== 'run' || job.dry_run) return null;
    const at = seen.get(job.id) || { next: 0, progress: emptyProgress() };
    if (job.lines > at.next) {
      const data = await fetch(`/api/jobs/${encodeURIComponent(job.id)}?since=${at.next}`).then((r) => (r.ok ? r.json() : null));
      if (data) {
        at.progress = runProgress(data.lines, at.progress);
        at.next = data.first + data.lines.length;
      }
    }
    seen.set(job.id, at);
    return at.progress;
  };
  const tick = async () => {
    if (busy) return;
    busy = true;
    clearTimeout(timer);
    let next = 4000;
    try {
      const list = await fetch('/api/jobs').then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
      fails = 0;
      setOffline(false);
      const job = list.jobs.find((j) => j.id === list.running);
      let progress = null;
      try {
        progress = await progressOf(job);
      } catch {
        progress = null;
      }
      for (const done of finishedJobs(before, list.jobs)) window.dispatchEvent(new CustomEvent('lab:job-finished', { detail: done }));
      before = new Map(list.jobs.map((j) => [j.id, j.status]));
      paintRunCard({ ...list, progress });
      window.dispatchEvent(new CustomEvent('lab:jobs', { detail: { ...list, job: job || null, progress } }));
      if (list.running) next = 1500;
    } catch {
      fails += 1;
      if (fails >= 2) {
        setOffline(true);
        paintRunCard({ offline: true });
      }
    }
    busy = false;
    timer = setTimeout(tick, document.hidden ? 60000 : next);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    tick();
  });
  tick();
  return { now: tick };
}
