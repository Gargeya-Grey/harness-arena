// Ladder page. Reads state.ladder from /api/state and shows what the stored runs do and do not
// say about each ladder task and each pair of setups. It repeats no statistic: counts, solved
// shares and sign tests come from the server (lab/lib/ladder.mjs), the same numbers `node lab ladder`
// prints. A tier is an estimate of expert time (docs/difficulty.md); it never reads as a result.
// The render functions are pure (they return HTML text) so node:test can load them; the DOM code
// sits at the foot, behind boot().
import { html, esc, setHtml, keepParts } from './js/util.js';
import { plural, caseName } from './js/words.js';
import { announce, captureFocus, restoreFocus } from './js/ui.js';

// Two setups are "told apart" when the exact sign test on the tasks only one of them solved is under this.
export const ALPHA = 0.05;
// The order lab/lib/ladder.mjs lists the information classes in: the most useful first.
export const INFORMATION = ['disagree', 'one-config', 'all-solved', 'all-unsolved', 'no-data'];
const INFO_TEXT = { disagree: 'Setups disagree', 'one-config': 'One setup only', 'all-solved': 'All solved', 'all-unsolved': 'None solved', 'no-data': 'No data' };
const INFO_HINT = {
  disagree: 'Some setups solved it and some did not. Only these tasks separate setups.',
  'one-config': 'One setup has a result. There is nothing to compare.',
  'all-solved': 'Every setup that ran it solved it. It does not separate them.',
  'all-unsolved': 'No setup solved it. Check the task for a defect before you read anything into it.',
  'no-data': 'No stored run has a counted result for it.',
};
const KIND_TEXT = { answer: 'Answer', code: 'Code', agent: 'Agent' };
const SORTS = [
  ['tier', 'Tier, easy first'],
  ['info', 'What the runs show, disagreements first'],
  ['time', 'Expert time, shortest first'],
  ['name', 'Name'],
];
// How a setup's user setup state reads, and the mark that carries it besides colour.
const STATE_TEXT = { loaded: ['user setup loaded', 'info'], 'kept out': ['user setup kept out', 'ok'], 'partly kept out': ['user setup partly kept out', 'warn'], leaked: ['user setup leaked in', 'err'], unknown: ['user setup unknown', 'warn'] };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const cap = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

/* ---------- Words and numbers, as the CLI prints them ---------- */
const fixed = (value) => (isNum(value) ? value.toFixed(2) : 'n/a');
// `node lab ladder` prints p under 0.005 as "< 0.01"; so does the page.
export const pText = (value) => (value < 0.005 ? '< 0.01' : fixed(value));
const scoreText = (value) => (value === 1 ? '1' : value === 0 ? '0' : fixed(value));

const trim = (n) => String(Number(n.toFixed(1)));
const unitOf = (minutes) => (minutes >= 60 ? 'h' : 'min');
const valueOf = (minutes) => trim(minutes >= 60 ? minutes / 60 : minutes);
/** Expert time in words: 6 -> "6 min", 90 -> "1.5 h". */
export const minutesText = (minutes) => (isNum(minutes) ? `${valueOf(minutes)} ${unitOf(minutes)}` : 'no estimate');
/** A tier's expert-time range: [0, 2] -> "up to 2 min", [2, 8] -> "2 to 8 min", [30, 120] -> "30 min to 2 h". */
export function rangeText(range) {
  if (!Array.isArray(range) || range.length !== 2) return '';
  const [lo, hi] = range;
  if (!lo) return `up to ${minutesText(hi)}`;
  return unitOf(lo) === unitOf(hi) ? `${valueOf(lo)} to ${minutesText(hi)}` : `${minutesText(lo)} to ${minutesText(hi)}`;
}

/* ---------- Reading state.ladder ---------- */
export const allTasks = (ladder) => (ladder?.suites || []).flatMap((suite) => suite.cases || []);
const configsOf = (ladder) => ladder?.configs || [];
const labelOf = (ladder, id) => configsOf(ladder).find((config) => config.config_id === id)?.label ?? id;
const letterMap = (ladder) => new Map(configsOf(ladder).map((config, index) => [config.config_id, LETTERS[index] ?? String(index + 1)]));
const refusedSuites = (ladder) => (ladder?.suites || []).filter((suite) => suite.refused);

/** The pair of two setups as the server counted it, turned so `a` comes first; null when they share no task. */
export function pairOf(ladder, a, b) {
  const found = (ladder?.pairs || []).find((pair) => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a));
  if (!found) return null;
  if (found.a === a) return { ...found, a_id: a, b_id: b };
  return { ...found, a_id: a, b_id: b, a_label: found.b_label, b_label: found.a_label, a_only: found.b_only, b_only: found.a_only, mean_diff: isNum(found.mean_diff) ? -found.mean_diff : found.mean_diff };
}

const separates = (task, a, b) => {
  const x = task.per_config?.find((entry) => entry.config_id === a);
  const y = task.per_config?.find((entry) => entry.config_id === b);
  return Boolean(x && y && x.solved !== y.solved);
};

/* ---------- The answer ---------- */
function pairsSentence(ladder) {
  const configs = configsOf(ladder);
  const pairs = ladder.pairs || [];
  if (configs.length < 2) return 'No pair exists: only one setup has results, so nothing can be compared.';
  if (!pairs.length) return 'No two setups ran a task in common, so the runs cannot compare any pair.';
  const apart = pairs.filter((pair) => pair.sign_p < ALPHA);
  const total = `${apart.length} of ${plural(pairs.length, 'pair')} of setups`;
  if (!apart.length) return `The runs cannot tell any of the ${plural(pairs.length, 'pair')} of setups apart (sign test, p below ${ALPHA}).`;
  const common = [...new Set(apart.flatMap((pair) => [pair.a, pair.b]))].filter((id) => apart.every((pair) => pair.a === id || pair.b === id));
  let who;
  if (apart.length > 1 && common.length) who = `All ${apart.length} include ${labelOf(ladder, common[0])}.`;
  else {
    const shown = apart.slice(0, 3).map((pair) => `${pair.a_label} and ${pair.b_label}`);
    who = `They are ${shown.join('; ')}${apart.length > 3 ? `; and ${apart.length - 3} more` : ''}.`;
  }
  return `The runs can tell ${total} apart (sign test, p below ${ALPHA}). ${who}`;
}

/** The sentence the page opens with and the lines under it; null when the ladder holds no task. */
export function headline(ladder) {
  const n = allTasks(ladder).length;
  if (!n) return null;
  if (!configsOf(ladder).length) {
    return { say: `No stored run counts for the ladder yet. All ${n} tasks have no data.`, more: ['A tier is an estimate of expert time. Until a run is stored, nothing here says how a model does on a task.'], pairs: '' };
  }
  const info = ladder.information || {};
  const d = info.disagree || 0;
  const o = info['one-config'] || 0;
  const solved = info['all-solved'] || 0;
  const unsolved = info['all-unsolved'] || 0;
  const none = info['no-data'] || 0;
  const more = [];
  if (d) more.push(`Some setups solved ${d === 1 ? 'it' : 'them'} and some did not. Only ${d === 1 ? 'this task separates' : 'these tasks separate'} setups.`);
  if (solved) more.push(`${solved} ${solved === 1 ? 'was' : 'were'} solved by every setup that ran ${solved === 1 ? 'it' : 'them'}, so ${solved === 1 ? 'it does' : 'they do'} not separate the setups.`);
  if (unsolved) more.push(`${unsolved} ${unsolved === 1 ? 'was' : 'were'} solved by none. Check ${unsolved === 1 ? 'it' : 'them'} for a defect first.`);
  if (none) more.push(`${none} ${none === 1 ? 'has' : 'have'} no data yet.`);
  return { say: `${d} of ${n} tasks ${d === 1 ? 'shows' : 'show'} a real disagreement. ${o} ${o === 1 ? 'has' : 'have'} only one setup.`, more, pairs: pairsSentence(ladder) };
}

function renderAnswer(ladder) {
  const h = headline(ladder);
  if (!h) return '';
  return String(html`<p class="ld-say">${h.say}</p>${h.pairs ? html`<p class="ld-more ld-pairs-say">${h.pairs}</p>` : ''}${h.more.length ? html`<p class="ld-more">${h.more.join(' ')}</p>` : ''}<div class="ld-foot"><span class="fair"><span class="mark-s info" aria-hidden="true"></span><span>A tier is an estimate of expert time, not a measured difficulty. Only the stored runs speak about models, and only for the tasks they ran. The p values are not corrected for the number of pairs.</span></span></div>`);
}

function renderMeta(ladder) {
  const n = allTasks(ladder).length;
  if (!n) return '';
  const suites = (ladder.suites || []).filter((suite) => suite.cases?.length).length;
  return [`${plural(n, 'task')} in ${plural(suites, 'suite')}`, `${plural(configsOf(ladder).length, 'setup')} with results`, 'Tiers are estimates of expert time'].join(' · ');
}

/* ---------- Notices: what the page cannot show, and why ---------- */
export function renderNotices(ladder) {
  const out = [];
  for (const suite of refusedSuites(ladder)) {
    out.push(html`<div class="ld-note is-warn" data-notice="refused" role="note"><span class="mark-s warn" aria-hidden="true"></span><div><strong>${suite.id}${suite.version ? ` ${suite.version}` : ''} cannot be compared.</strong> ${suite.refused} No number from this suite is shown.</div></div>`);
  }
  for (const warning of ladder?.warnings || []) {
    out.push(html`<div class="ld-note is-warn" data-notice="warning" role="note"><span class="mark-s warn" aria-hidden="true"></span><div>${warning.message}</div></div>`);
  }
  const odd = configsOf(ladder).filter((config) => !['loaded', 'kept out'].includes(config.setup_state ?? 'unknown'));
  const leaked = odd.filter((config) => config.setup_state === 'leaked');
  if (odd.length) {
    const lead = leaked.length
      ? html`<strong>${plural(leaked.length, 'setup')} loaded your own instructions although the test asked to keep them out.</strong> ${leaked.map((config) => config.label).join('; ')}. `
      : html`<strong>${plural(odd.length, 'setup')} did not keep your own setup fully out.</strong> `;
    out.push(html`<div class="ld-note" data-notice="setup-state" role="note"><span class="mark-s ${leaked.length ? 'err' : 'warn'}" aria-hidden="true"></span><div>${lead}Runs with a different user setup state never pool. Each one is its own row, and a leaked run is never mixed with a clean run of the same model.</div></div>`);
  }
  if (ladder?.error) out.push(html`<div class="ld-note is-warn" data-notice="error" role="note"><span class="mark-s warn" aria-hidden="true"></span><div><strong>The ladder report could not be built.</strong> ${ladder.error}</div></div>`);
  return out.map(String).join('');
}

export function renderEmpty(data, error = null) {
  if (error && !data) return String(html`<h2>The ladder did not load</h2><p>${error}. Check that <code>node lab dashboard</code> still runs, then try again.</p><button type="button" class="btn primary" data-act="reload" data-fk="reload">Try again</button>`);
  const ladder = data?.ladder;
  if (allTasks(ladder).length) return '';
  if (refusedSuites(ladder).length) return String(html`<h2>No ladder suite can be compared right now</h2><p>The reasons are above. The page shows no number for a suite that cannot be compared.</p>`);
  if (ladder?.error) return String(html`<h2>The ladder could not be read</h2><p>The reason is above.</p>`);
  return String(html`<h2>No ladder in this lab</h2><p>This data root has no ladder tasks. The ladder is three suites that share one tier table: see <code>docs/difficulty.md</code>.</p>`);
}

/* ---------- Tiers ---------- */
const tierEntry = (ladder, level) => (ladder?.tiers || []).find((tier) => tier.level === level);
// Every tier value carries the word "estimate": it is expert time, not a result.
const tierValue = (level, name, line) => html`<span class="ld-tierv" data-tier="${level ?? 'none'}"><span class="v">${level == null ? 'No tier' : cap(name || `Tier ${level}`)}</span><span class="sub">${line}</span></span>`;

/* ---------- Setups ---------- */
function stateMark(config) {
  const [text, shape] = STATE_TEXT[config.setup_state ?? 'unknown'] ?? STATE_TEXT.unknown;
  return html`<span class="who-sub ld-state" data-setup-state="${config.setup_state ?? 'unknown'}"><span class="mark-s ${shape}" aria-hidden="true"></span>${text}</span>`;
}

function tierCell(entry) {
  if (!entry?.counted) return html`<span class="nil">no data</span>`;
  const fewer = entry.counted < entry.tasks;
  return html`<span class="v">${entry.solved} of ${entry.counted}</span><span class="sub${fewer ? ' warn' : ''}">mean ${fixed(entry.mean)}${fewer ? ` · ran ${entry.counted} of ${entry.tasks} tasks` : ''}</span>`;
}

export function renderSetups(ladder) {
  const configs = configsOf(ladder);
  if (!configs.length) return String(html`<p class="ld-quiet">No setup has counted results for the ladder yet.</p>`);
  const letters = letterMap(ladder);
  const tiers = ladder.tiers || [];
  return String(html`<table class="ld-tbl ld-setups"><thead><tr><th scope="col" class="c-setup">Setup</th><th scope="col">Tasks run</th>${tiers.map((tier) => html`<th scope="col" class="c-tier">${tierValue(tier.level, tier.name, `${plural(tier.tasks, 'task')}, ${rangeText(tier.minutes)} (estimate)`)}</th>`)}<th scope="col">All tasks</th></tr></thead><tbody>${configs.map((config) => {
    const total = config.total || {};
    const fewer = total.counted < total.tasks;
    return html`<tr data-config="${config.config_id}"><th scope="row" class="c-setup"><span class="who"><span class="lt" aria-hidden="true">${letters.get(config.config_id)}</span><span class="who-text"><span class="who-name">${config.label}</span>${stateMark(config)}</span></span></th><td data-label="Tasks run"><span class="v">${total.counted} of ${total.tasks}</span>${fewer ? html`<span class="sub warn">Fewer than the ladder holds</span>` : ''}</td>${tiers.map((tier) => html`<td data-label="${cap(tier.name)} (estimate)">${tierCell(config.tiers?.[tier.level])}</td>`)}<td data-label="All tasks">${total.counted ? tierCell(total) : html`<span class="nil">no data</span>`}</td></tr>`;
  })}</tbody></table>`);
}

/* ---------- Pairs ---------- */
const readingText = (pair) => (pair.sign_p < ALPHA ? 'Can tell apart' : 'Cannot tell apart');

export function renderPairs(ladder, ui = {}) {
  const pairs = ladder?.pairs || [];
  const letters = letterMap(ladder);
  if (configsOf(ladder).length < 2) return String(html`<p class="ld-quiet" data-no-pair>No pair exists: ${configsOf(ladder).length === 1 ? 'only one setup has results, so nothing can be compared.' : 'no setup has results yet.'}</p>`);
  if (!pairs.length) return String(html`<p class="ld-quiet" data-no-pair>No two setups ran a task in common, so the runs cannot compare any pair.</p>`);
  const chosen = ui.a && ui.b ? pairOf(ladder, ui.a, ui.b) : null;
  const on = (pair) => chosen && ((pair.a === ui.a && pair.b === ui.b) || (pair.a === ui.b && pair.b === ui.a));
  return String(html`<table class="ld-tbl ld-pairs"><thead><tr><th scope="col" class="c-pair">Pair</th><th scope="col">Tasks both ran</th><th scope="col">Only the first solved</th><th scope="col">Only the second solved</th><th scope="col">Sign test p</th><th scope="col">What the runs show</th><th scope="col" class="c-act"><span class="sr">Show the tasks</span></th></tr></thead><tbody>${pairs.map((pair) => html`<tr data-pair="${pair.a}|${pair.b}"${on(pair) ? html` class="is-on"` : ''}><th scope="row" class="c-pair"><span class="ld-vs"><span class="lt" aria-hidden="true">${letters.get(pair.a)}</span><span class="who-name">${pair.a_label}</span></span><span class="ld-vs"><span class="lt" aria-hidden="true">${letters.get(pair.b)}</span><span class="who-name">${pair.b_label}</span></span></th><td data-label="Tasks both ran" class="num">${pair.shared}</td><td data-label="Only the first solved" class="num">${pair.a_only}</td><td data-label="Only the second solved" class="num">${pair.b_only}</td><td data-label="Sign test p" class="num">${pText(pair.sign_p)}</td><td data-label="What the runs show"><span class="ld-read${pair.sign_p < ALPHA ? ' is-apart' : ''}">${readingText(pair)}</span></td><td class="c-act"><button type="button" class="btn quiet small" data-act="pair-row" data-a="${pair.a}" data-b="${pair.b}" data-fk="pair:${pair.a}|${pair.b}">Show tasks</button></td></tr>`)}</tbody></table>`);
}

/** Which letter is which setup, above the task table, where the columns show only the letter. */
function renderKey(ladder) {
  const letters = letterMap(ladder);
  if (!configsOf(ladder).length) return '';
  return String(html`<ul class="ld-key" aria-label="Setup letters">${configsOf(ladder).map((config) => html`<li><span class="lt" aria-hidden="true">${letters.get(config.config_id)}</span><span class="col-name">${config.label}</span></li>`)}</ul>`);
}

/** The card for the two setups chosen in the selects: what only one of them solved, and the sign test. */
export function renderPairCard(ladder, ui = {}) {
  if (configsOf(ladder).length < 2 || !(ladder?.pairs || []).length) return '';
  if (!ui.a || !ui.b || ui.a === ui.b) return String(html`<p class="ld-quiet" data-pair-hint>Choose two setups, or a row below, to see which tasks tell them apart.</p>`);
  const pair = pairOf(ladder, ui.a, ui.b);
  const a = labelOf(ladder, ui.a);
  const b = labelOf(ladder, ui.b);
  if (!pair) return String(html`<div class="ld-card" data-pair-card><p class="ld-say-sm">${a} and ${b} ran no task in common, so the runs cannot compare them.</p></div>`);
  const apart = pair.sign_p < ALPHA;
  const gap = pair.a_only + pair.b_only;
  return String(html`<div class="ld-card" data-pair-card><p class="ld-say-sm">${a} solved <b class="num">${pair.a_only}</b> ${pair.a_only === 1 ? 'task' : 'tasks'} that ${b} did not. ${b} solved <b class="num">${pair.b_only}</b> that ${a} did not.</p><p class="ld-more">They both ran ${plural(pair.shared, 'task')}. ${apart ? html`The runs can tell them apart: sign test p ${pText(pair.sign_p)}.` : html`The runs cannot tell them apart: sign test p ${pText(pair.sign_p)}. A split at least this uneven could be chance.`}${isNum(pair.mean_diff) ? ` Mean score gap over those tasks: ${pair.mean_diff > 0 ? '+' : ''}${fixed(pair.mean_diff)} (${a} minus ${b}).` : ''}</p>${gap ? html`<button type="button" class="switch" role="switch" aria-checked="${ui.split ? 'true' : 'false'}" data-act="split" data-fk="split"><span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>Show only the ${gap} ${gap === 1 ? 'task' : 'tasks'} that tell them apart</button>` : ''}</div>`);
}

/* ---------- Tasks ---------- */
export function defaultUi() {
  return { kind: '', tier: '', info: '', sort: 'tier', a: '', b: '', split: false };
}

export function parseHash(text) {
  const out = defaultUi();
  const params = new URLSearchParams(String(text || '').replace(/^#/, ''));
  if (params.get('kind')) out.kind = params.get('kind');
  if (params.get('tier')) out.tier = params.get('tier');
  if (params.get('info')) out.info = params.get('info');
  if (params.get('sort')) out.sort = params.get('sort');
  if (params.get('a')) out.a = params.get('a');
  if (params.get('b')) out.b = params.get('b');
  out.split = params.get('split') === '1';
  return out;
}

export function hashFor(ui) {
  const params = new URLSearchParams();
  for (const key of ['kind', 'tier', 'info']) if (ui[key]) params.set(key, ui[key]);
  if (ui.sort && ui.sort !== 'tier') params.set('sort', ui.sort);
  if (ui.a) params.set('a', ui.a);
  if (ui.b) params.set('b', ui.b);
  if (ui.split) params.set('split', '1');
  const text = params.toString();
  return text ? `#${text}` : '';
}

/** Drop what the loaded data does not have, so a stale link shows the whole ladder rather than nothing. */
export function cleanUi(ui, ladder) {
  const tasks = allTasks(ladder);
  const ids = new Set(configsOf(ladder).map((config) => config.config_id));
  const next = { ...defaultUi(), ...ui };
  if (!tasks.some((task) => task.kind === next.kind)) next.kind = '';
  if (!(ladder?.tiers || []).some((tier) => String(tier.level) === next.tier)) next.tier = '';
  if (!INFORMATION.includes(next.info)) next.info = '';
  if (!SORTS.some(([key]) => key === next.sort)) next.sort = 'tier';
  if (!ids.has(next.a) || !ids.has(next.b) || next.a === next.b) {
    next.a = '';
    next.b = '';
    next.split = false;
  }
  return next;
}

const byId = (x, y) => x.case_id.localeCompare(y.case_id);
const byTier = (x, y) => (x.tier ?? 99) - (y.tier ?? 99);
const COMPARE = {
  tier: (x, y) => byTier(x, y) || byId(x, y),
  info: (x, y) => INFORMATION.indexOf(x.information) - INFORMATION.indexOf(y.information) || byTier(x, y) || byId(x, y),
  time: (x, y) => (x.human_minutes ?? Infinity) - (y.human_minutes ?? Infinity) || byTier(x, y) || byId(x, y),
  name: byId,
};

/** The tasks the toolbar lets through, in the chosen order. */
export function visibleTasks(ladder, ui) {
  const split = ui.split && ui.a && ui.b;
  return allTasks(ladder)
    .filter((task) => (!ui.kind || task.kind === ui.kind) && (!ui.tier || String(task.tier) === ui.tier) && (!ui.info || task.information === ui.info) && (!split || separates(task, ui.a, ui.b)))
    .sort(COMPARE[ui.sort] || COMPARE.tier);
}

function scoreCell(entry, letter, picked) {
  if (!entry) return html`<td data-label="${letter}" class="ld-score is-none${picked ? ' is-pick' : ''}"><span class="nil">not run</span></td>`;
  return html`<td data-label="${letter}" class="ld-score${picked ? ' is-pick' : ''}" data-solved="${entry.solved ? '1' : '0'}"><span class="ld-mk ${entry.solved ? 'ld-pass' : 'ld-fail'}" aria-hidden="true">${entry.solved ? '✓' : '✕'}</span><span class="v num">${scoreText(entry.mean)}</span><span class="sr">${entry.solved ? ' solved' : ' not solved'}</span>${entry.n > 1 ? html`<span class="sub">${plural(entry.n, 'try', 'tries')}</span>` : ''}</td>`;
}

// The case's basis comes from the case record, and only when that record still says what the ladder row says:
// a case reworked after the runs would otherwise show a basis for another estimate.
function basisOf(task, cases) {
  const tier = cases?.[task.case_id]?.metadata?.tier;
  if (!tier || tier.level !== task.tier || tier.human_minutes !== task.human_minutes) return '';
  return typeof tier.basis === 'string' ? tier.basis : '';
}

function taskRow(task, ladder, cases, ui) {
  const letters = letterMap(ladder);
  const configs = configsOf(ladder);
  const found = new Map((task.per_config || []).map((entry) => [entry.config_id, entry]));
  const basis = basisOf(task, cases);
  const tier = tierEntry(ladder, task.tier);
  return html`<tr data-case="${task.case_id}" data-info="${task.information}" data-kind="${task.kind}"><th scope="row" class="c-task"><span class="ld-name">${caseName(task.case_id, task.suite, cases?.[task.case_id]?.input)}</span><span class="ld-id">${KIND_TEXT[task.kind] || task.kind} task · ${task.case_id}</span>${basis ? html`<span class="ld-basis">Basis: ${basis}</span>` : ''}${task.flags?.length ? html`<details class="ld-flags"><summary class="disclose">Check this task${task.flags.length > 1 ? ` (${task.flags.length})` : ''}</summary>${task.flags.map((flag) => html`<p data-flag="${flag.flag}">${cap(flag.flag)}: solved by ${labelOf(ladder, flag.solved_by)}, failed on every try by ${labelOf(ladder, flag.failed_by)}, which scores higher on the ${flag.shared_tasks} other shared ${flag.shared_tasks === 1 ? 'task' : 'tasks'} (${fixed(flag.failed_by_mean)} against ${fixed(flag.solved_by_mean)}). Check the task for a defect first.</p>`)}</details>` : ''}</th><td data-label="Tier" class="c-tier">${tierValue(task.tier, tier?.name ?? task.tier_name, `estimate: ${minutesText(task.human_minutes)}`)}</td><td data-label="What the runs show" class="c-info"><span class="ld-info" data-info="${task.information}" title="${INFO_HINT[task.information] || ''}"><span class="ld-ishape" aria-hidden="true"></span>${INFO_TEXT[task.information] || task.information}</span><span class="sub">${task.configs_n ? `${task.configs_n} of ${plural(configs.length, 'setup')} ran it` : 'No setup ran it'}</span></td>${configs.map((config) => scoreCell(found.get(config.config_id), `${letters.get(config.config_id)} ${config.label}`, config.config_id === ui.a || config.config_id === ui.b))}</tr>`;
}

export function renderTasks(ladder, cases, ui) {
  const tasks = visibleTasks(ladder, ui);
  const configs = configsOf(ladder);
  const letters = letterMap(ladder);
  if (!tasks.length) return String(html`<p class="ld-quiet" data-no-match>No task matches these filters. <button type="button" class="link-btn" data-act="clear" data-fk="clear">Clear the filters</button></p>`);
  return String(html`<table class="ld-tbl ld-tasks"><thead><tr><th scope="col" class="c-task">Task</th><th scope="col" class="c-tier">Tier and expert time</th><th scope="col" class="c-info">What the runs show</th>${configs.map((config) => html`<th scope="col" class="c-score${config.config_id === ui.a || config.config_id === ui.b ? ' is-pick' : ''}" title="${config.label}"><span class="lt" aria-hidden="true">${letters.get(config.config_id)}</span><span class="sr">${config.label}</span></th>`)}</tr></thead><tbody>${tasks.map((task) => taskRow(task, ladder, cases, ui))}</tbody></table>`);
}

function renderTasksNote(ladder, ui) {
  const total = allTasks(ladder).length;
  const shown = visibleTasks(ladder, ui).length;
  const filtered = Boolean(ui.kind || ui.tier || ui.info || (ui.split && ui.a && ui.b));
  return `${shown === total ? `All ${plural(total, 'task')}` : `${shown} of ${plural(total, 'task')}`}${filtered ? ' shown' : ''}`;
}

/* ---------- What the page reads ---------- */
function renderEvidence(ladder) {
  const versions = ladder?.versions || [];
  const parts = [];
  if (versions.length) {
    const used = versions.filter((item) => item.version != null && !item.refused);
    const left = versions.reduce((sum, item) => sum + (item.left_out_runs || 0), 0);
    parts.push(html`<p>Suite versions used: ${used.map((item) => `${item.suite} ${item.version} (${plural(item.runs, 'run')}${item.cases_from === 'frozen copy' ? '; cases and tiers of its frozen copy' : ''})`).join(', ') || 'none'}. Left out: ${plural(left, 'counted run')} of other versions.</p>`);
  }
  parts.push(html`<p>A setup solves a task when its mean score over its counted tries is 1. A score is the share of hidden checks passed, so partial work does not solve. Only closed runs that match the evidence ledger and have scores count.</p>`);
  const problems = ladder?.problems || [];
  if (problems.length) parts.push(html`<details class="ld-problems"><summary class="disclose">Ladder checks that fail (${problems.length})</summary><ul>${problems.map((line) => html`<li>${line}</li>`)}</ul></details>`);
  return parts.map(String).join('');
}

/* ---------- Selects: the field is a well and the menu floats, so the open list follows the theme ---------- */
const field = (def) => {
  const current = def.options.find((option) => option.value === def.value) ?? def.options[0];
  return html`<div class="ld-field"><span class="ld-flabel" id="${def.id}-l">${def.label}</span><button type="button" class="lsel" id="${def.id}" data-sel="${def.id}" data-fk="sel:${def.id}" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${def.id}-l ${def.id}"><span class="lsel-text">${current?.text ?? ''}</span><svg class="i" aria-hidden="true"><use href="#i-down"/></svg></button></div>`;
};

/** Every select on the page: its options and its current value. */
export function selectDefs(ladder, ui) {
  const configs = configsOf(ladder);
  const letters = letterMap(ladder);
  const kinds = [...new Set(allTasks(ladder).map((task) => task.kind))].sort((x, y) => Object.keys(KIND_TEXT).indexOf(x) - Object.keys(KIND_TEXT).indexOf(y));
  const setup = (excluded) => [{ value: '', text: 'Choose a setup' }, ...configs.filter((config) => config.config_id !== excluded).map((config) => ({ value: config.config_id, text: `${letters.get(config.config_id)}  ${config.label}` }))];
  return [
    { id: 'sel-kind', scope: 'tasks', label: 'Kind', value: ui.kind, options: [{ value: '', text: 'All kinds' }, ...kinds.map((kind) => ({ value: kind, text: KIND_TEXT[kind] || kind }))] },
    { id: 'sel-tier', scope: 'tasks', label: 'Tier (estimate)', value: ui.tier, options: [{ value: '', text: 'All tiers' }, ...(ladder?.tiers || []).map((tier) => ({ value: String(tier.level), text: `${cap(tier.name)} (estimate)` }))] },
    { id: 'sel-info', scope: 'tasks', label: 'What the runs show', value: ui.info, options: [{ value: '', text: 'All tasks' }, ...INFORMATION.map((name) => ({ value: name, text: INFO_TEXT[name] }))] },
    { id: 'sel-sort', scope: 'tasks', label: 'Sort by', value: ui.sort, options: SORTS.map(([value, text]) => ({ value, text })) },
    { id: 'sel-a', scope: 'pair', label: 'Setup A', value: ui.a, options: setup(ui.b) },
    { id: 'sel-b', scope: 'pair', label: 'Setup B', value: ui.b, options: setup(ui.a) },
  ];
}

const renderToolbar = (ladder, ui, scope) => String(selectDefs(ladder, ui).filter((def) => def.scope === scope).map(field).join(''));

/* ---------- The page ---------- */
/** Every block of the page as HTML text. */
export function renderPage(data, ui = defaultUi(), error = null) {
  const ladder = data?.ladder || null;
  const shown = cleanUi(ui, ladder);
  const hasTasks = allTasks(ladder).length > 0;
  const configs = configsOf(ladder);
  return {
    ui: shown,
    meta: renderMeta(ladder),
    answer: hasTasks ? renderAnswer(ladder) : '',
    notices: renderNotices(ladder),
    empty: renderEmpty(data, error),
    setups: hasTasks ? renderSetups(ladder) : '',
    pairsOn: hasTasks && configs.length > 0,
    pairPick: hasTasks && configs.length >= 2 ? renderToolbar(ladder, shown, 'pair') : '',
    pairCard: hasTasks ? renderPairCard(ladder, shown) : '',
    pairs: hasTasks ? renderPairs(ladder, shown) : '',
    tools: hasTasks ? renderToolbar(ladder, shown, 'tasks') : '',
    key: hasTasks ? renderKey(ladder) : '',
    tasks: hasTasks ? renderTasks(ladder, data?.cases, shown) : '',
    tasksNote: hasTasks ? renderTasksNote(ladder, shown) : '',
    evidence: hasTasks ? renderEvidence(ladder) : '',
  };
}

/* ---------- Browser only ---------- */
const V = { data: null, error: null, ui: defaultUi(), menu: null };
const $ = (id) => document.getElementById(id);

function paint() {
  const saved = captureFocus();
  const page = renderPage(V.data, V.ui, V.error);
  V.ui = page.ui;
  const has = Boolean(page.answer);
  if (V.data) setHtml($('ld-meta'), keepParts(page.meta));
  else $('ld-meta').textContent = V.error ? '' : 'Reading the stored runs…';
  $('answer').hidden = !has;
  if (has) setHtml($('answer'), page.answer);
  setHtml($('notices'), page.notices);
  $('empty').hidden = !page.empty;
  setHtml($('empty'), page.empty);
  for (const id of ['setups-sect', 'tasks-sect', 'evidence-sect']) $(id).hidden = !has;
  $('pairs-sect').hidden = !(has && page.pairsOn);
  setHtml($('setups'), page.setups);
  setHtml($('pair-pick'), page.pairPick);
  $('pair-pick').hidden = !page.pairPick;
  setHtml($('pair-card'), page.pairCard);
  setHtml($('pairs'), page.pairs);
  setHtml($('tools'), page.tools);
  setHtml($('tasks-key'), page.key);
  setHtml($('tasks'), page.tasks);
  $('tasks-note').textContent = page.tasksNote;
  setHtml($('evidence'), page.evidence);
  const hash = hashFor(V.ui);
  if (hash !== location.hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  restoreFocus(saved, ['reload']);
  if (has) performance.mark('ladder-first-row');
}

async function load() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    V.data = await res.json();
    V.error = null;
  } catch (error) {
    V.error = error.message;
  }
  paint();
}

function closeMenu(refocus = true) {
  const menu = V.menu;
  if (!menu) return;
  menu.el.remove();
  menu.btn.setAttribute('aria-expanded', 'false');
  menu.btn.removeAttribute('aria-controls');
  V.menu = null;
  if (refocus) menu.btn.focus({ preventScroll: true });
}

function setActive(menu, index) {
  const items = [...menu.el.children];
  menu.index = (index + items.length) % items.length;
  items.forEach((item, at) => item.classList.toggle('active', at === menu.index));
  menu.el.setAttribute('aria-activedescendant', items[menu.index].id);
  items[menu.index].scrollIntoView({ block: 'nearest' });
}

function openMenu(btn) {
  closeMenu(false);
  const def = selectDefs(V.data?.ladder, V.ui).find((item) => item.id === btn.dataset.sel);
  if (!def) return;
  const el = document.createElement('div');
  el.className = 'lmenu';
  el.id = `${btn.id}-menu`;
  el.tabIndex = -1;
  el.setAttribute('role', 'listbox');
  el.setAttribute('aria-labelledby', `${btn.id}-l`);
  el.innerHTML = def.options.map((option, at) => `<div class="lopt" role="option" id="${btn.id}-o${at}" data-value="${esc(option.value)}" aria-selected="${option.value === def.value}"><span class="lopt-text">${esc(option.text)}</span><svg class="i" aria-hidden="true"><use href="#i-check"/></svg></div>`).join('');
  document.body.append(el);
  const box = btn.getBoundingClientRect();
  el.style.minWidth = `${Math.round(box.width)}px`;
  el.style.maxWidth = `${Math.max(240, window.innerWidth - 32)}px`;
  const room = window.innerHeight - box.bottom;
  const up = room < Math.min(el.offsetHeight, 320) + 12 && box.top > room;
  el.classList.toggle('up', up);
  el.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = up ? `${Math.max(8, box.top - el.offsetHeight - 6)}px` : `${box.bottom + 6}px`;
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-controls', el.id);
  V.menu = { el, btn, def, index: 0 };
  setActive(V.menu, Math.max(0, def.options.findIndex((option) => option.value === def.value)));
  el.focus({ preventScroll: true });
}

function choose(id, value) {
  const ui = V.ui;
  if (id === 'sel-kind') ui.kind = value;
  else if (id === 'sel-tier') ui.tier = value;
  else if (id === 'sel-info') ui.info = value;
  else if (id === 'sel-sort') ui.sort = value;
  else if (id === 'sel-a') ui.a = value;
  else if (id === 'sel-b') ui.b = value;
  if (id === 'sel-a' || id === 'sel-b') ui.split = Boolean(ui.split && ui.a && ui.b);
  paint();
  announce($('tasks-note').textContent);
}

function pickFromMenu() {
  const menu = V.menu;
  if (!menu) return;
  const id = menu.def.id;
  const value = menu.def.options[menu.index].value;
  closeMenu(false);
  choose(id, value);
  const again = document.querySelector(`[data-fk="sel:${id}"]`);
  if (again) again.focus({ preventScroll: true });
}

function onClick(event) {
  const menu = V.menu;
  if (menu && !menu.el.contains(event.target) && !menu.btn.contains(event.target)) closeMenu(false);
  const option = event.target.closest('.lopt');
  if (option && menu && menu.el.contains(option)) {
    setActive(menu, [...menu.el.children].indexOf(option));
    pickFromMenu();
    return;
  }
  const target = event.target.closest('[data-act], [data-sel]');
  if (!target) return;
  if (target.dataset.sel) {
    if (menu && menu.btn === target) closeMenu();
    else openMenu(target);
    return;
  }
  const act = target.dataset.act;
  if (act === 'pair-row') {
    V.ui.a = target.dataset.a;
    V.ui.b = target.dataset.b;
    V.ui.split = false;
    paint();
    announce(document.querySelector('[data-pair-card] .ld-say-sm')?.textContent || '');
    document.getElementById('pair-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (act === 'split') {
    V.ui.split = !V.ui.split;
    paint();
    announce($('tasks-note').textContent);
  } else if (act === 'clear') {
    V.ui = { ...defaultUi(), a: V.ui.a, b: V.ui.b };
    paint();
  } else if (act === 'reload') {
    load();
  }
}

function onKey(event) {
  const menu = V.menu;
  if (menu) {
    if (event.key === 'ArrowDown') setActive(menu, menu.index + 1);
    else if (event.key === 'ArrowUp') setActive(menu, menu.index - 1);
    else if (event.key === 'Home') setActive(menu, 0);
    else if (event.key === 'End') setActive(menu, menu.def.options.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') pickFromMenu();
    else if (event.key === 'Escape') closeMenu();
    else if (event.key === 'Tab') closeMenu(false);
    else return;
    event.preventDefault();
    return;
  }
  const btn = event.target.closest?.('[data-sel]');
  if (btn && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    openMenu(btn);
    event.preventDefault();
  }
}

async function boot() {
  const shell = await import('./shell.js');
  shell.mountShell({ current: 'ladder' });
  shell.watchJobs();
  V.ui = parseHash(location.hash);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => closeMenu(false));
  window.addEventListener('scroll', () => closeMenu(false), { passive: true });
  window.addEventListener('hashchange', () => {
    if (location.hash === hashFor(V.ui)) return;
    V.ui = parseHash(location.hash);
    paint();
  });
  window.addEventListener('lab:job-finished', () => load());
  await load();
}

if (typeof document !== 'undefined' && document.getElementById('ld-meta')) boot();
