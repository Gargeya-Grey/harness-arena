// Setups: one row per shown setup, best first. A column shows only when one of the setups has a value;
// the best value carries the accent only when the answer could name a winner.
import { S, ctx, shownSetups, aggOf, letterOf, setupOf } from './model.js';
import { bestMarks, passedText } from './verdict.js';
import { passRangeText } from './chart-data.js';
import { durText, plural } from './words.js';
import { html, setHtml, isNum, usdText, tokText } from './util.js';
import { setupTags } from './setup-tags.js';

const none = () => html`<span class="nil">–</span>`;

const setupText = (cfg) => (setupOf(cfg) === 'loaded' ? null : `user setup ${setupOf(cfg)}`);

const warned = (cfg) => setupOf(cfg) !== 'loaded' && setupOf(cfg) !== 'kept out';

// `withWarning: false` leaves out a state the table row shows on a line of its own (setupWarning).
export const harnessLine = (cfg, { withWarning = true } = {}) => [`${cfg.harness.name} ${cfg.harness.version}`, cfg.effort ? `${cfg.effort} effort` : null, withWarning || !warned(cfg) ? setupText(cfg) : null].filter(Boolean).join(' · ');

// A setup whose user setup is not known to be out says so on its own line, as the model warning does.
function setupWarning(cfg) {
  const state = setupOf(cfg);
  if (!warned(cfg)) return '';
  const missing = (cfg.setup_missing || []).length ? ` (missing ${cfg.setup_missing.join(', ')})` : '';
  return html`<span class="who-sub warn" data-setup-state="${state}" title="${setupText(cfg)}${missing}">${setupText(cfg)}</span>`;
}

function passedCell(s, best) {
  const f = s.facts;
  if (!f.decided) return html`<span class="nil">${f.incomplete ? 'unfinished' : f.unchecked ? 'not checked' : '–'}</span>`;
  const share = f.passed / f.decided;
  return html`<span class="pass"><span class="pbar" aria-hidden="true"><i style="width:${(share * 100).toFixed(1)}%"></i></span><span class="v">${passedText(f)}</span></span>${f.unchecked ? html`<span class="sub">${f.unchecked} not checked</span>` : ''}`;
}

const COLUMNS = [
  { key: 'passed', label: 'Passed', show: () => true, cell: passedCell },
  { key: 'time', label: 'Typical time', show: (list) => list.some((s) => s.facts.time !== null), cell: (s) => (s.facts.time === null ? none() : html`<span class="v">${durText(s.facts.time)}</span>`) },
  { key: 'price', label: 'Total API-equivalent price', show: (list) => list.some((s) => s.facts.price !== null), cell: (s) => (s.facts.price === null ? none() : html`<span class="v">${usdText(s.facts.price)}</span>`) },
  { key: 'incomplete', label: 'Unfinished', show: (list) => list.some((s) => s.facts.incomplete > 0), cell: (s) => (s.facts.incomplete ? html`<span class="v">${s.facts.incomplete} of ${s.facts.tries}</span><span class="sub">unjudged${s.facts.incompleteElapsed == null ? '' : ` · ${durText(s.facts.incompleteElapsed)} elapsed`}</span>` : html`<span class="nil">none</span>`) },
  { key: 'errors', label: 'Errors', show: (list) => list.some((s) => s.facts.errors > s.facts.incomplete), cell: (s) => (s.facts.errors > s.facts.incomplete ? html`<span class="v bad">${s.facts.errors - s.facts.incomplete} of ${s.facts.tries}</span>${s.errorReason ? html`<span class="sub">${s.errorReason}</span>` : ''}${s.facts.lost ? html`<span class="sub">${s.facts.lost} lost to limits or sign-in, not counted</span>` : ''}` : html`<span class="nil">none</span>`) },
  { key: 'rating', label: 'Your rating', show: (list) => list.some((s) => s.facts.ratings > 0), cell: (s) => (s.facts.ratings ? html`<span class="v">${s.facts.rating.toFixed(1)}</span><span class="sub">of 5, ${plural(s.facts.ratings, 'rating')}</span>` : html`<span class="nil">none yet</span>`) },
  // Details: one click away.
  { key: 'slow', label: 'Slow end', details: true, show: (list) => list.some((s) => s.facts.slow !== null && s.facts.timed > 1), cell: (s) => (s.facts.slow === null ? none() : html`<span class="v">${durText(s.facts.slow)}</span>`) },
  { key: 'range', label: 'Pass range', details: true, show: (list) => list.some((s) => s.facts.decided > 0), cell: (s) => {
    const a = aggOf(s.id) || {};
    return html`<span class="v">${passRangeText(a)}</span><span class="sub">${a.counted_n || 0} decided tries · ${plural(a.cases_n || 0, 'case')}</span>`;
  } },
  { key: 'ppp', label: 'Price per pass', details: true, show: (list) => list.some((s) => s.facts.pricePerPass !== null), cell: (s) => (s.facts.pricePerPass === null ? none() : html`<span class="v">${usdText(s.facts.pricePerPass)}</span>`) },
  { key: 'tokens', label: 'Tokens per try', details: true, show: (list) => list.some((s) => isNum((aggOf(s.id) || {}).mean_input_tokens)), cell: (s) => {
    const a = aggOf(s.id) || {};
    return isNum(a.mean_input_tokens) ? html`<span class="v">${tokText(a.mean_input_tokens)} in</span><span class="sub">${tokText(a.mean_output_tokens)} out</span>` : none();
  } },
  { key: 'model', label: 'Model time', details: true, show: (list) => list.some((s) => isNum((aggOf(s.id) || {}).p50_model_latency_ms)), cell: (s) => {
    const v = (aggOf(s.id) || {}).p50_model_latency_ms;
    return isNum(v) ? html`<span class="v">${durText(v)}</span>` : none();
  } },
];

// Is the answer from the model the row names? A mismatch means the harness used another model.
function modelWarning(s) {
  const notes = [];
  if (s.facts.mismatched) notes.push(`${s.facts.mismatched} answered by another model`);
  if (s.cfg.pinned === false) notes.push('alias, not a pinned snapshot');
  return notes.length ? html`<span class="who-sub warn">${notes.join(' · ')}</span>` : '';
}

const DETAIL_NOTE ='Slow end: 1 try in 20 was slower. Pass range: the server’s 95% case-aware interval, accounting for repeated tries of the same case; at least 3 counted cases are needed.';

export function renderSetups() {
  const host = document.getElementById('setups');
  const foot = document.getElementById('setups-foot');
  const c = ctx();
  if (!c) return;
  const list = shownSetups();
  const marks = bestMarks(list);
  const cols = COLUMNS.filter((col) => (!col.details || S.details) && col.show(list));
  const best = (col, s) => (col.key === 'passed' && marks.passed.has(s.id)) || (col.key === 'time' && marks.time.has(s.id)) || (col.key === 'price' && marks.price.has(s.id));
  const multi = list.length > 1;
  const head = cols.map((col) => html`<th scope="col" class="c-${col.key}">${col.label}</th>`);
  const rows = list.map((s) => html`<tr>
    <th scope="row" class="c-setup"><span class="who">${multi ? html`<span class="lt" aria-hidden="true">${letterOf(s.id)}</span>` : ''}<span class="who-text"><span class="who-name">${s.cfg.display_name}</span>${setupTags(s.cfg)}${setupText(s.cfg) && !warned(s.cfg) ? html`<span class="who-sub">${setupText(s.cfg)}</span>` : ''}${setupWarning(s.cfg)}${modelWarning(s)}</span></span></th>
    ${cols.map((col) => {
      const on = best(col, s);
      return html`<td class="c-${col.key}${on ? ' is-best' : ''}" data-label="${col.label}">${col.cell(s, on)}${on ? html`<span class="sr"> (best)</span>` : ''}</td>`;
    })}
  </tr>`);
  setHtml(
    host,
    html`<table class="tbl setups-tbl${S.details ? ' is-detailed' : ''}">
      <caption class="sr">${plural(list.length, 'setup')} on this test, best first.${marks.passed.size || marks.time.size || marks.price.size ? ' The best value in a column is marked.' : ''}</caption>
      <thead><tr><th scope="col" class="c-setup">Setup</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`,
  );
  const notes = [];
  if (list.some((s) => s.facts.price !== null)) notes.push(html`<p>Total API-equivalent price adds every priced attempt, including failed or unfinished calls. It is a list-price estimate, not a bill. The chart shows price per priced try.</p>`);
  if (!list.some((s) => s.facts.price !== null)) notes.push(html`<p>No API prices: these models are free or not priced.</p>`);
  if (marks.passed.size || marks.time.size || marks.price.size) notes.push(html`<p><span class="best-dot" aria-hidden="true"></span>The best value in its column.</p>`);
  if (S.details) notes.push(html`<p>${DETAIL_NOTE}</p>`);
  const hidden = c.config_ids.length - list.length;
  if (hidden > 0) notes.push(html`<p>${plural(hidden, 'more setup')} not shown. <button type="button" class="link-btn" data-act="choose" data-fk="choose-foot">Choose setups</button></p>`);
  setHtml(foot, html`${notes}`);
  foot.hidden = !notes.length;
  const choose = document.getElementById('choose-btn');
  if (choose) choose.hidden = c.config_ids.length < 2;
  const det = document.getElementById('details-btn');
  if (det) {
    det.setAttribute('aria-pressed', String(S.details));
    det.textContent = S.details ? 'Hide details' : 'Details';
  }
}
