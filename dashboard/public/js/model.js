// UI state and derived data. No DOM here.

export const MAX_SELECTED = 8;
export const DEFAULT_SELECTED = 4;

export const S = {
  data: null,
  loading: true,
  error: null,
  ctxKey: null,
  sel: [],
  sort: { key: null, dir: 'desc' },
  view: 'overview',
  only: false,
  fails: false,
  runStatus: 'all',
  revCase: '',
  fHarness: [],
  fProvider: [],
  rep: 'all',
  lat: 'harness',
  cfgQuery: '',
  cfgOpen: false,
  insp: null, // { obsId, tab }
  review: null,
  boardId: '',
  boardForm: false,
  boardConfirm: false,
};

let index = new Map();

export function setData(data) {
  S.data = data;
  index = new Map();
  // The one owner of "counts nowhere" in the client: every view reads this index, so an
  // observation of a run that does not count (trusted false) is in no view. Runs lists it.
  for (const o of (data.observations || []).filter((item) => item.trusted !== false)) {
    let ctxIndex = index.get(o.context_key);
    if (!ctxIndex) {
      ctxIndex = { cells: new Map(), byId: new Map(), list: [] };
      index.set(o.context_key, ctxIndex);
    }
    const key = `${o.case_id}\u0000${o.config_id}`;
    if (!ctxIndex.cells.has(key)) ctxIndex.cells.set(key, []);
    ctxIndex.cells.get(key).push(o);
    ctxIndex.byId.set(o.id, o);
    ctxIndex.list.push(o);
  }
  for (const ctxIndex of index.values()) {
    for (const list of ctxIndex.cells.values()) list.sort((a, b) => a.repeat - b.repeat);
  }
}

export const contexts = () => (S.data ? S.data.contexts : []);
export const ctx = () => contexts().find((c) => c.key === S.ctxKey) || null;
export const cfgOf = (id) => (S.data && S.data.configs ? S.data.configs[id] : null) || null;
export const selectedCfgs = () => S.sel.map(cfgOf).filter(Boolean);
// The lineup letter: A for the first selected configuration, B for the second. Empty when not selected.
export const letterOf = (id) => {
  const i = S.sel.indexOf(id);
  return i < 0 ? '' : String.fromCharCode(65 + i);
};
export const caseOf = (id) => (S.data && S.data.cases ? S.data.cases[id] : null) || null;

export function cellObs(caseId, cfgId, key = S.ctxKey) {
  const i = index.get(key);
  return (i && i.cells.get(`${caseId}\u0000${cfgId}`)) || [];
}
export function obsById(id) {
  const i = index.get(S.ctxKey);
  if (i && i.byId.has(id)) return i.byId.get(id);
  for (const other of index.values()) if (other.byId.has(id)) return other.byId.get(id);
  return null;
}
export function ctxObservations() {
  const i = index.get(S.ctxKey);
  return i ? i.list : [];
}
export const aggOf = (cfgId) => {
  const c = ctx();
  return (c && c.aggregates && c.aggregates[cfgId]) || null;
};

export function repeatsOf(c = ctx()) {
  if (!c) return 1;
  let max = Number(c.repeats) || 1;
  for (const o of ctxObservations()) if (o.repeat + 1 > max) max = o.repeat + 1;
  return max;
}

// Two lines for the context picker. The first names suite and prompt; the second
// holds what tells two contexts apart: cases, repeats, evaluators, runs, date.
// When two contexts still read the same, the case ids are added.
export function ctxParts(c, all = [c]) {
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const mainOf = (x) => `${x.suite.id} ${x.suite.version} · ${x.prompt.id} v${x.prompt.version}`;
  const subOf = (x, ids) => [
    plural(x.cases.length, 'case') + (ids ? ` (${x.cases.join(', ')})` : ''),
    plural(x.repeats, 'repeat'),
    (x.evaluators || []).map((e) => `${e.id} v${e.version}`).sort().join(' + '),
    x.partial ? 'subset' : '',
    plural(x.runs.length, 'run'),
    x.latest_run_at ? `latest ${String(x.latest_run_at).slice(0, 10)}` : '',
  ].filter(Boolean).join(' · ');
  const main = mainOf(c);
  const plain = subOf(c, false);
  const twin = all.some((o) => o !== c && mainOf(o) === main && subOf(o, false) === plain);
  return { main, sub: twin ? subOf(c, true) : plain };
}

export function ctxLabel(c, withDate = false) {
  const base = `${c.suite.id} ${c.suite.version} · ${c.prompt.id} v${c.prompt.version} · ${c.cases.length} case${c.cases.length === 1 ? '' : 's'} · ${c.repeats} repeat${c.repeats === 1 ? '' : 's'}`;
  const tail = [];
  if (c.partial) tail.push('subset');
  if (withDate && c.latest_run_at) tail.push(String(c.latest_run_at).slice(0, 10));
  return tail.length ? `${base} · ${tail.join(' · ')}` : base;
}

// Outcome of one observation: a word, never colour alone.
export function outcome(o) {
  if (!o) return { kind: 'none', text: 'not run', glyph: '–' };
  if (o.status === 'error') return { kind: 'error', text: 'error', glyph: '!' };
  if (o.status === 'unscored' || o.passed === null || o.passed === undefined) return { kind: 'unscored', text: 'unscored', glyph: '○' };
  if (o.passed) return { kind: 'pass', text: 'pass', glyph: '✓' };
  return { kind: 'fail', text: 'fail', glyph: '✕' };
}

// A short unique name per configuration for direct labels in charts.
export function chartNames(cfgs) {
  const base = (c) => c.display_name || c.model_key || c.id;
  const steps = [
    (c) => base(c),
    (c) => `${base(c)} · ${c.harness.name}`,
    (c) => `${base(c)} · ${c.harness.name} ${c.harness.version}`,
    (c) => `${base(c)} · ${c.harness.name} ${c.harness.version} · ${c.effort || 'default'}`,
  ];
  const level = new Map(cfgs.map((c) => [c.id, 0]));
  for (let pass = 0; pass < steps.length; pass += 1) {
    const counts = new Map();
    cfgs.forEach((c) => {
      const n = steps[level.get(c.id)](c);
      counts.set(n, (counts.get(n) || 0) + 1);
    });
    let changed = false;
    cfgs.forEach((c) => {
      const n = steps[level.get(c.id)](c);
      if (counts.get(n) > 1 && level.get(c.id) < steps.length - 1) {
        level.set(c.id, level.get(c.id) + 1);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return new Map(cfgs.map((c) => [c.id, steps[level.get(c.id)](c)]));
}

const decodingOf = (c) => JSON.stringify([c.params ? c.params.temperature ?? null : null, c.params ? c.params.max_tokens ?? null : null]);

export function comparison(cfgs) {
  if (cfgs.length === 0) return { mode: 'empty', axes: [], text: '', note: '' };
  if (cfgs.length === 1) return { mode: 'single', axes: [], text: 'Single configuration', note: 'Nothing to compare yet. Add a second configuration.' };
  const differs = (fn) => new Set(cfgs.map(fn)).size > 1;
  const axes = [];
  if (differs((c) => c.model_key)) axes.push('model');
  if (differs((c) => `${c.harness.name}@${c.harness.version}`)) axes.push('harness');
  if (differs((c) => c.effort ?? '')) axes.push('effort');
  if (differs(decodingOf)) axes.push('decoding');
  if (differs((c) => c.user_config || 'loaded')) axes.push('setup');
  if (axes.length === 0) return { mode: 'replicate', axes, text: 'Replicate', note: 'Same model, harness, effort, decoding and user setup.' };
  if (axes.length === 1) return { mode: 'controlled', axes, text: `Controlled: ${axes[0]}`, note: 'One axis differs. Other axes are held constant.' };
  return { mode: 'descriptive', axes, text: `Descriptive: ${axes.join(', ')}`, note: 'Causal claims are not supported.' };
}

export const VIEWS = ['overview', 'answers', 'charts', 'runs', 'review'];

// URL hash: #view=<name>&ctx=<encoded key>&cfg=<id,id>. A bare #answers also works.
export function readHash() {
  const out = { view: null, ctx: null, cfg: null };
  const h = location.hash.replace(/^#/, '');
  if (!h) return out;
  if (!h.includes('=')) {
    if (VIEWS.includes(h)) out.view = h;
    return out;
  }
  for (const piece of h.split('&')) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const k = piece.slice(0, eq);
    let v = piece.slice(eq + 1);
    try {
      v = decodeURIComponent(v);
    } catch {
      continue;
    }
    if (k === 'view' && VIEWS.includes(v)) out.view = v;
    if (k === 'ctx') out.ctx = v;
    if (k === 'cfg') out.cfg = v ? v.split(',').filter(Boolean) : [];
  }
  return out;
}
export function writeHash() {
  if (!S.ctxKey) return;
  const next = `#view=${S.view}&ctx=${encodeURIComponent(S.ctxKey)}&cfg=${S.sel.map(encodeURIComponent).join(',')}`;
  if (location.hash !== next) {
    try {
      history.replaceState(null, '', next);
    } catch {
      /* the URL stays as it was */
    }
  }
}

// Choose the context and a valid, ordered selection of configurations.
export function chooseContext(key, wanted) {
  const c = contexts().find((x) => x.key === key) || contexts()[0] || null;
  S.ctxKey = c ? c.key : null;
  if (!c) {
    S.sel = [];
    return;
  }
  const valid = new Set(c.config_ids);
  let sel = (wanted || []).filter((id, i, arr) => valid.has(id) && arr.indexOf(id) === i);
  if (!wanted || sel.length === 0) sel = c.config_ids.slice(0, DEFAULT_SELECTED);
  S.sel = sel.slice(0, MAX_SELECTED);
  if (S.rep !== 'all' && Number(S.rep.slice(1)) >= repeatsOf(c)) S.rep = 'all';
}

export function findContextForBoard(board) {
  const b = board.context;
  const want = [...b.cases].sort().join('|');
  return contexts().find((c) => c.suite.id === b.suite && c.prompt.id === b.prompt && c.repeats === b.repeats && [...c.cases].sort().join('|') === want) || null;
}
