// Results page state and derived data. No DOM here.
import { facts, rankSetups, errorReason } from './verdict.js';

export const MAX_SHOWN = 8;

export const S = {
  data: null,
  error: null,
  ctxKey: null,
  sel: [], // the setups shown, in table order
  custom: false, // true when the owner chose the setups; the link then carries them
  only: null, // "Only where setups differ": null follows the default for the test
  details: false,
  insp: null, // { obsId, tab }
  review: null,
  boardId: '',
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
      ctxIndex = { cells: new Map(), byId: new Map(), byCfg: new Map(), list: [] };
      index.set(o.context_key, ctxIndex);
    }
    const key = `${o.case_id}\u0000${o.config_id}`;
    if (!ctxIndex.cells.has(key)) ctxIndex.cells.set(key, []);
    ctxIndex.cells.get(key).push(o);
    if (!ctxIndex.byCfg.has(o.config_id)) ctxIndex.byCfg.set(o.config_id, []);
    ctxIndex.byCfg.get(o.config_id).push(o);
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
// What a setup kept out of the harness's own setup: loaded, kept out, partly kept out, leaked or unknown.
// A state from before setup_state existed has only user_config.
export const setupOf = (cfg) => cfg.setup_state || (cfg.user_config === 'isolated' ? 'kept out' : 'loaded');
export const selectedCfgs = () => S.sel.map(cfgOf).filter(Boolean);
// The short letter of a shown setup: A for the first row of the table. Empty when not shown.
export const letterOf = (id) => {
  const i = S.sel.indexOf(id);
  return i < 0 ? '' : String.fromCharCode(65 + i);
};
// The test's own text of a case (an older suite version) comes first. Default: the open test.
export const caseOf = (id, c = ctx()) => c?.case_data?.[id] || (S.data && S.data.cases ? S.data.cases[id] : null) || null;

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
export function ctxObservations(key = S.ctxKey) {
  const i = index.get(key);
  return i ? i.list : [];
}
export function aggOf(cfgId, c = ctx()) {
  return (c && c.aggregates && c.aggregates[cfgId]) || null;
}

export function repeatsOf(c = ctx()) {
  if (!c) return 1;
  let max = Number(c.repeats) || 1;
  for (const o of ctxObservations(c.key)) if (o.repeat + 1 > max) max = o.repeat + 1;
  return max;
}

// Outcome of one try: a word and a shape, never colour alone.
export function outcome(o) {
  if (!o) return { kind: 'none', text: 'not run', glyph: '–' };
  if (o.status === 'error') return { kind: 'error', text: 'no answer', glyph: '!' };
  if (o.status === 'unscored' || o.passed === null || o.passed === undefined) return { kind: 'unscored', text: 'not checked', glyph: '○' };
  if (o.passed) return { kind: 'pass', text: 'passed', glyph: '✓' };
  return { kind: 'fail', text: 'failed', glyph: '✕' };
}

// A short unique name per setup: the model, then the harness, version and effort only when needed.
export function chartNames(cfgs) {
  const base = (c) => c.display_name || c.model_key || c.id;
  const steps = [
    (c) => base(c),
    (c) => `${base(c)} · ${c.harness.name}`,
    (c) => `${base(c)} · ${c.harness.name} ${c.harness.version}`,
    (c) => `${base(c)} · ${c.harness.name} ${c.harness.version} · ${c.effort || 'default'}`,
    // Two setups that differ only in what the user setup did (kept out against leaked) need it in the name.
    (c) => `${base(c)} · ${c.harness.name} ${c.harness.version} · ${c.effort || 'default'} · user setup ${setupOf(c)}`,
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

// What differs between the shown setups: one axis is a fair test, several a mixed one.
export function comparison(cfgs) {
  if (cfgs.length === 0) return { mode: 'empty', axes: [] };
  if (cfgs.length === 1) return { mode: 'single', axes: [] };
  const differs = (fn) => new Set(cfgs.map(fn)).size > 1;
  const axes = [];
  if (differs((c) => c.model_key)) axes.push('model');
  if (differs((c) => `${c.harness.name}@${c.harness.version}`)) axes.push('harness');
  if (differs((c) => c.effort ?? '')) axes.push('effort');
  if (differs(decodingOf)) axes.push('decoding');
  if (differs((c) => c.setup_state || c.user_config || 'loaded')) axes.push('setup');
  if (axes.length === 0) return { mode: 'replicate', axes };
  if (axes.length === 1) return { mode: 'controlled', axes };
  return { mode: 'descriptive', axes };
}

// Every setup of a test with what it did, named uniquely among the given list.
export function setupsOf(ids, c = ctx()) {
  const cfgs = ids.map(cfgOf).filter(Boolean);
  const names = chartNames(cfgs);
  const byCfg = (index.get(c && c.key) || { byCfg: new Map() }).byCfg;
  // Answers stored with no score count for nothing; `unscoredAnswers` lets the page say how many there are.
  return cfgs.map((cfg) => ({ id: cfg.id, cfg, name: names.get(cfg.id), facts: { ...facts(aggOf(cfg.id, c)), unscoredAnswers: (c && c.unscored_answers && c.unscored_answers[cfg.id]) || 0 }, errorReason: errorReason(byCfg.get(cfg.id) || []) }));
}
export const shownSetups = () => setupsOf(S.sel);

// The default set: every setup of the test, best first, up to MAX_SHOWN.
export function defaultSel(c) {
  return rankSetups(setupsOf(c.config_ids, c)).map((s) => s.id).slice(0, MAX_SHOWN);
}

// URL hash: #ctx=<key>&cfg=<id,id>&only=0|1. The Compare page's #view=… links still open.
export function readHash(hash = location.hash) {
  const out = { ctx: null, cfg: null, only: null };
  const h = String(hash).replace(/^#/, '');
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
    if (k === 'ctx') out.ctx = v;
    if (k === 'cfg') out.cfg = v ? v.split(',').filter(Boolean) : [];
    if (k === 'only' && (v === '0' || v === '1')) out.only = v === '1';
  }
  return out;
}
export function hashFor() {
  if (!S.ctxKey) return '';
  let h = `#ctx=${encodeURIComponent(S.ctxKey)}`;
  if (S.custom) h += `&cfg=${S.sel.map(encodeURIComponent).join(',')}`;
  if (S.only !== null) h += `&only=${S.only ? 1 : 0}`;
  return h;
}
export function writeHash() {
  const next = hashFor();
  if (!next || location.hash === next) return;
  try {
    history.replaceState(null, '', next);
  } catch {
    /* the address stays as it was */
  }
}

// Open a test. A list of setups from a link or a saved view is kept; otherwise every setup shows.
export function chooseContext(key, wanted = null) {
  const c = contexts().find((x) => x.key === key) || newestContext();
  S.ctxKey = c ? c.key : null;
  if (!c) {
    S.sel = [];
    S.custom = false;
    return;
  }
  const valid = new Set(c.config_ids);
  // A saved view or an old link can name the id a setup had before its user-setup state split it
  // (config.legacy_id). It shows every setup of this test that had that id: the clean setup keeps the
  // old id, so a name that is still valid can mean its leaked sibling too. A view saved after the split
  // that names the kept out setup therefore shows the leaked one beside it, which is the safer error.
  // The limit never drops a setup the view named: a sibling only takes a place that is left over.
  const groups = (wanted || []).map((id) => ({ id, setups: c.config_ids.filter((other) => other === id || cfgOf(other)?.legacy_id === id) })).filter((group) => group.setups.length);
  const unique = (ids) => ids.filter((id, i, arr) => arr.indexOf(id) === i);
  const firstChoice = unique(groups.map((group) => (group.setups.includes(group.id) ? group.id : group.setups[0])));
  const all = unique(groups.flatMap((group) => group.setups));
  const room = Math.max(0, MAX_SHOWN - firstChoice.length);
  const keep = new Set([...firstChoice.slice(0, MAX_SHOWN), ...all.filter((id) => !firstChoice.includes(id)).slice(0, room)]);
  const sel = all.filter((id) => keep.has(id));
  S.custom = sel.length > 0;
  S.sel = S.custom ? sel : defaultSel(c);
}

function newestContext() {
  return [...contexts()].sort((a, b) => String(b.latest_run_at || '').localeCompare(String(a.latest_run_at || '')))[0] || null;
}

export function findContextForBoard(board) {
  const b = board.context;
  const want = [...b.cases].sort().join('|');
  return contexts().find((c) => c.suite.id === b.suite && c.prompt.id === b.prompt && c.repeats === b.repeats && [...c.cases].sort().join('|') === want) || null;
}

// "Only where setups differ" is on by default from 5 cases up.
const onlyDefault = (c = ctx()) => Boolean(c && c.cases.length >= 5);
export const onlyOn = () => (S.only === null ? onlyDefault() : S.only);
