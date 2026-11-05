// Leaderboard: one dense ledger row per selected configuration, sortable by header, best values in leaf-ink.
import { S, ctx, selectedCfgs, aggOf, chartNames, letterOf } from './model.js';
import { html, raw, setHtml, isNum, NA, msHtml, msText, usdHtml, usdText, tokText, pctText, fixed } from './util.js';
import { cfgShort } from './configs.js';

export const MIN_N = 3;

// Each column: how to read a value, which direction is better, and when a value is firm enough to rank.
export const COLUMNS = [
  { key: 'config', label: 'Configuration', value: (r) => r.cfg.display_name.toLowerCase(), text: true },
  { key: 'quality', label: 'Quality', better: 'high', value: (r) => r.agg && r.agg.mean_quality, firm: (a) => a.counted_n >= MIN_N },
  { key: 'pass', label: 'Pass rate', better: 'high', value: (r) => r.agg && r.agg.pass_rate, firm: (a) => a.counted_n >= MIN_N },
  { key: 'errors', label: 'Errors', better: 'low', value: (r) => (r.agg && r.agg.n ? r.agg.errors_n / r.agg.n : null), firm: (a) => a.n >= MIN_N },
  { key: 'p50', label: 'p50', sub: 'latency', better: 'low', value: (r) => r.agg && r.agg.p50_latency_ms, firm: (a) => a.latency_n >= MIN_N },
  { key: 'p95', label: 'p95', sub: 'latency', better: 'low', value: (r) => r.agg && r.agg.p95_latency_ms, firm: (a) => a.latency_n >= MIN_N },
  { key: 'cost', label: 'Cost', sub: 'not billed', better: 'low', value: (r) => r.agg && r.agg.total_cost_usd, firm: (a) => a.ok_n >= MIN_N },
  { key: 'cpp', label: 'Cost / pass', sub: 'not billed', better: 'low', value: (r) => r.agg && r.agg.cost_per_passed_case, firm: (a) => a.passed_n >= 1 && a.scored_n >= MIN_N },
  { key: 'tokens', label: 'Tokens', sub: 'mean per call', value: (r) => (r.agg && isNum(r.agg.mean_input_tokens) && isNum(r.agg.mean_output_tokens) ? r.agg.mean_input_tokens + r.agg.mean_output_tokens : null) },
];

// The first sort puts the best value on top.
export function firstDir(key) {
  const col = COLUMNS.find((c) => c.key === key);
  return !col || col.text || col.better === 'low' ? 'asc' : 'desc';
}

export function leaderRows() {
  const cfgs = selectedCfgs();
  const rows = cfgs.map((cfg) => ({ cfg, agg: aggOf(cfg.id), best: {} }));
  for (const col of COLUMNS) {
    if (!col.better) continue;
    const firm = rows.filter((r) => r.agg && isNum(col.value(r)) && col.firm(r.agg));
    if (firm.length < 2) continue;
    const vals = firm.map((r) => col.value(r));
    const top = col.better === 'high' ? Math.max(...vals) : Math.min(...vals);
    if (vals.every((v) => v === top)) continue;
    firm.forEach((r) => {
      if (col.value(r) === top) r.best[col.key] = true;
    });
  }
  return rows;
}

function sortedRows(rows) {
  const { key, dir } = S.sort;
  if (!key) return rows;
  const col = COLUMNS.find((c) => c.key === key);
  if (!col) return rows;
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: col.value(r) }))
    .sort((a, b) => {
      const an = a.v === null || a.v === undefined || (typeof a.v === 'number' && !Number.isFinite(a.v));
      const bn = b.v === null || b.v === undefined || (typeof b.v === 'number' && !Number.isFinite(b.v));
      if (an && bn) return a.i - b.i;
      if (an) return 1;
      if (bn) return -1;
      if (a.v === b.v) return a.i - b.i;
      return (a.v < b.v ? -1 : 1) * sign;
    })
    .map((x) => x.r);
}

const joinDot = (items) => items.map((item, i) => (i ? html` · ${item}` : item));
const none = () => html`<span class="muted">${NA}</span>`;
const cell = (main, sub) => html`<span class="cell-main">${main}</span>${sub ? html`<span class="cell-sub">${sub}</span>` : ''}`;

function qualityCell(r) {
  const a = r.agg;
  if (!a) return none();
  if (!isNum(a.mean_quality)) return cell('unscored', html`n <span class="num">${a.n}</span>, none scored`);
  const ci = a.quality_ci ? html`<span class="num">${fixed(a.quality_ci[0])}–${fixed(a.quality_ci[1])}</span>` : 'CI n/a';
  return cell(html`<span class="num">${fixed(a.mean_quality)}</span>`, html`${ci} · n <span class="num">${a.counted_n}</span> · <span class="num">${a.cases_n}</span> case${a.cases_n === 1 ? '' : 's'}`);
}

function passCell(r) {
  const a = r.agg;
  if (!a) return none();
  if (!isNum(a.pass_rate)) return cell('unscored');
  const ci = a.pass_rate_ci ? html`<span class="num">${pctText(a.pass_rate_ci[0])}–${pctText(a.pass_rate_ci[1])}</span>` : 'CI n/a';
  return cell(html`<span class="num">${pctText(a.pass_rate)}</span>`, html`${ci} · <span class="num">${a.passed_n}/${a.counted_n}</span>`);
}

function errorsCell(r) {
  const a = r.agg;
  if (!a) return none();
  // failed errors score 0 in quality; lost ones (quota, sign-in, CLI missing) are left out of it.
  const parts = [a.failed_n ? html`<span class="num">${a.failed_n}</span> failed, scored 0` : '', a.lost_n ? html`<span class="num">${a.lost_n}</span> lost to limits or sign-in, not scored` : ''].filter(Boolean);
  return html`<span class="cell-main${a.errors_n > 0 ? ' bad' : ''}"><span class="num">${a.errors_n}/${a.n}</span></span>${a.errors_n > 0 ? html`<span class="cell-sub bad">${parts.length ? joinDot(parts) : html`<span class="num">${pctText(a.error_rate, 0)}</span> failed`}</span>` : html`<span class="cell-sub">none</span>`}`;
}

const latCell = (key, showN) => (r) => {
  const a = r.agg;
  if (!a || !isNum(a[key])) return none();
  return cell(msHtml(a[key]), showN && isNum(a.latency_n) ? html`n <span class="num">${a.latency_n}</span>` : '');
};

function costCell(r) {
  const a = r.agg;
  if (!a || !isNum(a.total_cost_usd)) return none();
  return cell(usdHtml(a.total_cost_usd));
}

function cppCell(r) {
  const a = r.agg;
  if (!a) return none();
  if (!isNum(a.cost_per_passed_case)) return html`<span class="cell-main muted">${a.scored_n === 0 ? 'unscored' : a.passed_n === 0 ? 'no pass' : NA}</span>`;
  return cell(usdHtml(a.cost_per_passed_case), html`<span class="num">${a.passed_n}</span> passed`);
}

function tokensCell(r) {
  const a = r.agg;
  if (!a || !isNum(a.mean_input_tokens)) return none();
  return html`<span class="cell-main"><span class="num">${tokText(a.mean_input_tokens)}</span> in · <span class="num">${tokText(a.mean_output_tokens)}</span> out</span>`;
}

function speedCell(r) {
  const a = r.agg;
  if (!a || !isNum(a.mean_tokens_per_second)) return none();
  return cell(html`<span class="num">${fixed(a.mean_tokens_per_second, 1)}</span>`);
}

function humanCell(r) {
  const a = r.agg;
  if (!a || !isNum(a.human_mean)) return html`<span class="muted">no ratings</span>`;
  return cell(html`<span class="num">${fixed(a.human_mean, 1)}</span>`, html`n <span class="num">${a.human_n}</span>`);
}

// Is the answer from the model the row names? A mismatch means the harness used another model.
function modelWarning(r) {
  const a = r.agg;
  const notes = [];
  if (a && a.model_mismatch_n) notes.push(html`<span class="num">${a.model_mismatch_n}</span> answered by another model`);
  if (r.cfg.pinned === false) notes.push('alias, not a pinned snapshot');
  return notes.length ? html`<span class="cell-sub bad">${joinDot(notes)}</span>` : '';
}

const CELLS = { quality: qualityCell, pass: passCell, errors: errorsCell, p50: latCell('p50_latency_ms', true), p95: latCell('p95_latency_ms', false), cost: costCell, cpp: cppCell, tokens: tokensCell };

function names(list) {
  return list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export function verdictParts(rows) {
  const label = chartNames(rows.map((r) => r.cfg));
  const out = [];
  const pick = (key, title, fmt) => {
    const col = COLUMNS.find((c) => c.key === key);
    const best = rows.filter((r) => r.best[key]);
    if (rows.length < 2) return;
    if (!best.length) {
      const firm = rows.filter((r) => r.agg && isNum(col.value(r)) && col.firm(r.agg));
      out.push({ title, text: firm.length < 2 ? 'insufficient data' : 'tie, no difference', note: '', thin: firm.length < 2 });
      return;
    }
    const first = best[0];
    let note = '';
    if (key === 'quality') {
      const others = rows.filter((r) => !r.best.quality && r.agg && r.agg.quality_ci && first.agg.quality_ci && r.agg.quality_ci[1] >= first.agg.quality_ci[0]);
      if (others.length) note = `intervals overlap with ${names(others.map((o) => label.get(o.cfg.id)))}, so this is not a ranking`;
    }
    out.push({ title, text: `${names(best.map((r) => label.get(r.cfg.id)))} (${fmt(first)})`, note });
  };
  pick('quality', 'Highest quality', (r) => fixed(r.agg.mean_quality));
  pick('p50', 'Fastest', (r) => `${msText(r.agg.p50_latency_ms)} p50`);
  pick('cpp', 'Cheapest per pass', (r) => usdText(r.agg.cost_per_passed_case));
  return out;
}

export function renderLeaderboard() {
  const host = document.getElementById('lb');
  const note = document.getElementById('lb-note');
  const c = ctx();
  if (!c) {
    note.textContent = '';
    setHtml(host, html`<div class="empty">No runs yet. Run <code>node lab run experiments/smoke-harness-sweep.yaml</code>, then Refresh.</div>`);
    return;
  }
  const rows = leaderRows();
  if (!rows.length) {
    note.textContent = '';
    setHtml(host, html`<div class="empty">No configurations selected. Add at least two from the lineup to compare them.</div>`);
    return;
  }
  const obsN = rows.reduce((s, r) => s + (r.agg ? r.agg.n || 0 : 0), 0);
  note.textContent = `n = ${obsN} observations. Cost is API-equivalent and not billed. Green = best in column.`;
  const shown = sortedRows(rows);
  const parts = verdictParts(rows);
  const allThin = parts.length > 0 && parts.every((p) => p.thin);
  const verdict = rows.length < 2
    ? html`<div class="verdict-line">Select a second configuration to compare. One configuration cannot be ranked.</div>`
    : allThin
      ? html`<div class="verdict-line">Insufficient data to rank. A ranking needs ${MIN_N} or more scored observations on at least 2 configurations.</div>`
      : html`${parts.map((p) => html`<div class="verdict-line"><span class="verdict-k">${p.title}</span><strong>${p.text}</strong>${p.note ? html` (${p.note})` : ''}</div>`)}`;
  const sortKey = S.sort.key;
  const head = COLUMNS.map((col) => {
    const active = sortKey === col.key;
    const aria = active ? (S.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    const arrow = active ? (S.sort.dir === 'asc' ? '↑' : '↓') : '';
    const text = col.sub ? `${col.label} ${col.sub}` : col.label;
    return html`<th scope="col" class="${col.text ? 'col-text' : 'col-num'} metric-${col.key}" aria-sort="${aria}" aria-label="Sort by ${text}">
      <button type="button" class="th-sort" data-act="sort" data-key="${col.key}" data-fk="sort:${col.key}" aria-label="Sort by ${text}">${col.label}<span aria-hidden="true">${arrow}</span></button>
      ${col.sub ? html`<span class="th-sub" aria-hidden="true">${col.sub}</span>` : ''}
    </th>`;
  });
  const body = shown.map((r) => html`<tr>
    <th scope="row" class="row-head" data-label="Configuration"><div class="row-id"><span class="lt" aria-hidden="true">${letterOf(r.cfg.id)}</span><span><span class="cell-name">${r.cfg.display_name}</span><span class="cell-sub">${cfgShort(r.cfg)}</span>${modelWarning(r)}</span></div></th>
    ${COLUMNS.slice(1).map((col) => html`<td data-label="${col.label}${col.sub ? ` (${col.sub})` : ''}" class="col-num metric-${col.key}${r.best[col.key] ? ' is-best' : ''}">${CELLS[col.key](r)}${r.best[col.key] ? html`<span class="sr"> (best in column)</span>` : ''}</td>`)}
  </tr>`);
  const sortOptions = COLUMNS.map((col) => html`<option value="${col.key}"${sortKey === col.key ? raw(' selected') : ''}>${col.label}${col.sub ? ` (${col.sub})` : ''}</option>`);
  setHtml(
    host,
    html`<div class="verdict" id="verdict">${verdict}</div>
    <div class="lb-sort"><label class="label" for="lb-sort-select">Sort by</label>
      <select id="lb-sort-select" data-change="sort-select"><option value="">Column order</option>${sortOptions}</select></div>
    <div class="lb-wrap" role="region" aria-label="Leaderboard table" tabindex="0">
      <table class="ledger ledger-lb">
        <caption class="sr">Leaderboard for the ${rows.length} selected configurations. Cost is API-equivalent and not billed. The best value in each column is green and bold, and marked for screen readers.</caption>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`,
  );
}

// Headline numbers for the Overview tiles.
export function renderTiles() {
  const host = document.getElementById('tiles');
  if (!host) return;
  const rows = ctx() ? leaderRows() : [];
  const label = chartNames(rows.map((r) => r.cfg));
  const withAgg = rows.filter((r) => r.agg);
  // A tile names the same winners as the verdict line: the rows marked best.
  // With no marked row (one configuration, or all equal), it names every firm
  // row at the top value, so a tie never shows as one winner. Rows below MIN_N
  // never win a tile, as they never win the verdict line.
  const best = (key) => {
    const col = COLUMNS.find((x) => x.key === key);
    const marked = withAgg.filter((r) => r.best[key]);
    if (marked.length) return marked;
    const list = withAgg.filter((r) => isNum(col.value(r)) && col.firm(r.agg));
    if (!list.length) return [];
    const vals = list.map((r) => col.value(r));
    const top = col.better === 'high' ? Math.max(...vals) : Math.min(...vals);
    return list.filter((r) => col.value(r) === top);
  };
  const obsN = withAgg.reduce((s, r) => s + (r.agg.n || 0), 0);
  const scoredN = withAgg.reduce((s, r) => s + (r.agg.scored_n || 0), 0);
  const errN = withAgg.reduce((s, r) => s + (r.agg.errors_n || 0), 0);
  const q = best('quality');
  const p = best('p50');
  const k = best('cpp');
  // Values exist but none is firm: say so, instead of "no data".
  const thin = (key, empty) => {
    const col = COLUMNS.find((x) => x.key === key);
    return withAgg.some((r) => isNum(col.value(r))) ? `n below ${MIN_N}: no winner yet` : empty;
  };
  // A winner tile names the model on one line and the harness on the next, so a
  // narrow tile never cuts off which configuration won. The harness version is
  // added only when two selected configurations would otherwise read the same.
  const sameKey = (cfg) => `${cfg.display_name}|${cfg.harness?.name}|${cfg.effort || ''}`;
  const keyCount = new Map();
  for (const r of rows) keyCount.set(sameKey(r.cfg), (keyCount.get(sameKey(r.cfg)) || 0) + 1);
  const harnessLine = (cfg) => [cfg.harness?.name, keyCount.get(sameKey(cfg)) > 1 ? cfg.harness?.version : null, cfg.effort].filter(Boolean).join(' · ');
  // ' ' keeps an empty line's height, so every tile has the same rows.
  // `who` is the winner line: letter badges and a name.
  const tile = (name, value, who, sub, n, cls = '') => html`<div class="tile"><div class="tile-label" title="${name}">${name}</div><p class="tile-value${cls}">${value}</p><div class="tile-who">${who || ' '}</div><div class="tile-sub" title="${sub}">${sub || ' '}</div><div class="tile-n">${n || ' '}</div></div>`;
  const badge = (r) => html`<span class="lt" aria-hidden="true">${letterOf(r.cfg.id)}</span>`;
  const winner = (name, list, value, empty, nOf, unit) => {
    if (!list.length) return tile(name, NA, html`<span class="muted">${empty}</span>`, '', '');
    // A count the server did not send prints nothing, never NaN.
    const ns = list.map(nOf).filter(isNum);
    const lo = ns.length ? Math.min(...ns) : null;
    const hi = ns.length ? Math.max(...ns) : null;
    const n = lo === null ? '' : `n ${lo === hi ? lo : `${lo}–${hi}`}${unit}${list.length > 1 ? ' each' : ''}`;
    if (list.length === 1) {
      const r = list[0];
      const nm = r.cfg.display_name || label.get(r.cfg.id);
      return tile(name, value(r), html`${badge(r)}<span title="${nm}">${nm}</span>`, harnessLine(r.cfg), n);
    }
    // A tie shows every tied letter; the line below names them, and its title keeps the full list.
    return tile(name, value(list[0]), html`${list.map(badge)}<span>${list.length}-way tie</span>`, names(list.map((r) => label.get(r.cfg.id))), n);
  };
  setHtml(
    host,
    html`${winner('Best quality', q, (r) => fixed(r.agg.mean_quality), thin('quality', 'no scored runs'), (r) => r.agg.counted_n ?? r.agg.scored_n, '')}
    ${winner('Fastest p50', p, (r) => msText(r.agg.p50_latency_ms), thin('p50', 'no successful calls'), (r) => r.agg.latency_n, '')}
    ${winner('Lowest cost per pass', k, (r) => usdText(r.agg.cost_per_passed_case), thin('cpp', 'no passed cases'), (r) => r.agg.passed_n, ' passed')}
    ${tile('Error rate', obsN ? pctText(errN / obsN, 1) : NA, obsN ? html`<span>${errN} of ${obsN} attempts failed</span>` : html`<span class="muted">no attempts</span>`, obsN ? `${scoredN} scored by an evaluator` : '', obsN ? `n ${obsN}` : '', errN ? ' bad' : '')}`,
  );
}

// Plain data for exports.
export function leaderTable() {
  const rows = leaderRows();
  const header = ['Configuration', 'Harness', 'Harness version', 'Effort', 'Access', 'Quality', 'Quality CI low', 'Quality CI high', 'Counted n', 'Pass rate', 'Pass CI low', 'Pass CI high', 'Passed n', 'Errors', 'Attempts n', 'Latency p50 ms', 'Latency p95 ms', 'Total cost USD (API-equivalent, not billed)', 'Cost per passed case USD', 'Mean input tokens', 'Mean cache read tokens', 'Mean output tokens', 'Tokens per second', 'Human mean', 'Human n'];
  const data = rows.map((r) => {
    const a = r.agg || {};
    return [
      r.cfg.display_name, r.cfg.harness.name, r.cfg.harness.version, r.cfg.effort || 'default', r.cfg.access_method,
      a.mean_quality, a.quality_ci ? a.quality_ci[0] : null, a.quality_ci ? a.quality_ci[1] : null, a.counted_n ?? a.scored_n,
      a.pass_rate, a.pass_rate_ci ? a.pass_rate_ci[0] : null, a.pass_rate_ci ? a.pass_rate_ci[1] : null, a.passed_n,
      a.errors_n, a.n, a.p50_latency_ms, a.p95_latency_ms, a.total_cost_usd, a.cost_per_passed_case,
      a.mean_input_tokens, a.mean_cache_read_tokens, a.mean_output_tokens, a.mean_tokens_per_second, a.human_mean, a.human_n,
    ];
  });
  return { rows, header, data };
}
