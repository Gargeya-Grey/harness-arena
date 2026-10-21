// Answers: the experiment grid. Cases are rows, selected configurations are columns, every repeat is a chip.
import { S, ctx, selectedCfgs, caseOf, cellObs, repeatsOf, outcome, chartNames, letterOf } from './model.js';
import { html, raw, setHtml, isNum, msText } from './util.js';
import { cfgShort } from './configs.js';
import { thumbHtml } from './artifacts.js';

const asText = (v) => (v === null || v === undefined || v === '' ? '' : typeof v === 'string' ? v : JSON.stringify(v));

function questionText(k) {
  if (!k) return 'Case definition not found.';
  return Object.values(k.input || {}).map(asText).filter(Boolean).join(' · ') || 'No input variables.';
}

const filterRep = (list, rep) => (rep === 'all' ? list : list.filter((o) => `r${o.repeat}` === rep));

function disagrees(cfgs, caseId, repFilter) {
  const sigs = new Set();
  for (const c of cfgs) {
    const list = filterRep(cellObs(caseId, c.id), repFilter);
    if (!list.length) continue;
    sigs.add([...new Set(list.map((o) => outcome(o).kind))].sort().join('+'));
  }
  return sigs.size > 1;
}

function hasFailure(cfgs, caseId, repFilter) {
  return cfgs.some((c) => filterRep(cellObs(caseId, c.id), repFilter).some((o) => {
    const k = outcome(o).kind;
    return k === 'fail' || k === 'error';
  }));
}

function chipHtml(o, label, caseId) {
  const out = outcome(o);
  const open = S.insp && S.insp.obsId === o.id;
  const detail = o.status === 'error' ? (o.error && o.error.type) || 'error' : isNum(o.latency_ms) ? msText(o.latency_ms) : 'no latency';
  return html`<button type="button" class="rep-chip${open ? ' is-open' : ''}" data-act="inspect" data-obs="${o.id}" data-fk="obs:${o.id}" title="Repeat ${o.repeat}: ${out.text}, ${detail}" aria-label="Open repeat ${o.repeat} of ${label} for ${caseId}: ${out.text}"${open ? raw(' aria-current="true"') : ''}>${thumbHtml(o)}<span class="mark mark-${out.kind}" aria-hidden="true">${out.glyph}</span><span class="rep-n" aria-hidden="true">r${o.repeat}</span></button>`;
}

// The text of one answer under the chips: the open observation when it is in this cell, else the first one.
function excerpt(list) {
  const o = list.find((x) => S.insp && S.insp.obsId === x.id) || list[0];
  if (o.status === 'error') return html`<p class="ans-text is-error">${(o.error && o.error.type) || 'error'}: ${(o.error && o.error.message) || 'no message'}</p>`;
  const text = o.response && typeof o.response.text === 'string' ? o.response.text.trim() : '';
  if (!text) return html`<p class="ans-text is-empty">No response text.</p>`;
  return html`<p class="ans-text${outcome(o).kind === 'fail' ? ' is-fail' : ''}" title="${text.length > 600 ? text.slice(0, 600) + '…' : text}">${text.length > 400 ? text.slice(0, 400) + '…' : text}</p>`;
}

export function renderAnswers() {
  const host = document.getElementById('ans');
  const note = document.getElementById('ans-note');
  const c = ctx();
  const cfgs = selectedCfgs();
  if (!c) {
    note.textContent = '';
    setHtml(host, html`<div class="empty">No runs yet. Run <code>node lab run experiments/smoke-harness-sweep.yaml</code>, then Refresh.</div>`);
    return;
  }
  if (!cfgs.length) {
    note.textContent = '';
    setHtml(host, html`<div class="empty">No configurations selected. Add configurations to the lineup to see their answers next to each other.</div>`);
    return;
  }
  const repeats = repeatsOf(c);
  const names = chartNames(cfgs);
  const allCases = c.cases;
  const rows = allCases.filter((id) => (!S.only || disagrees(cfgs, id, S.rep)) && (!S.fails || hasFailure(cfgs, id, S.rep)));
  const diffCount = allCases.filter((id) => disagrees(cfgs, id, S.rep)).length;
  note.textContent = `${allCases.length} case${allCases.length === 1 ? '' : 's'} · ${cfgs.length} configurations · ${repeats} repeat${repeats === 1 ? '' : 's'}`;

  const repButtons = ['all', ...Array.from({ length: repeats }, (_, i) => `r${i}`)].map((r) => html`<button type="button" class="ctl" data-act="rep" data-rep="${r}" data-fk="rep:${r}" aria-pressed="${String(S.rep === r)}">${r === 'all' ? 'All repeats' : r}</button>`);
  const toolbar = html`<div class="toolbar">
    <button type="button" class="ctl" data-act="only" data-fk="only" aria-pressed="${String(S.only)}">Only disagreements</button>
    <button type="button" class="ctl" data-act="fails" data-fk="fails" aria-pressed="${String(S.fails)}">Only failures</button>
    <span class="toolbar-sep" aria-hidden="true">|</span>
    <div class="fchips" role="group" aria-label="Repeat filter">${repButtons}</div>
    <span class="toolbar-count">Showing <span class="num">${rows.length}</span> of <span class="num">${allCases.length}</span> · <span class="num">${diffCount}</span> differ</span>
  </div>`;

  const head = cfgs.map((x) => html`<th scope="col" class="col-cfg"><div class="row-id"><span class="lt" aria-hidden="true">${letterOf(x.id)}</span><span><span class="cell-name" title="${names.get(x.id)}">${names.get(x.id)}</span><span class="cell-sub">${cfgShort(x)}</span></span></div></th>`);
  const body = rows.map((caseId) => {
    const k = caseOf(caseId);
    const exp = k ? asText(k.expected) : '';
    const cells = cfgs.map((x) => {
      const list = filterRep(cellObs(caseId, x.id), S.rep);
      const label = names.get(x.id);
      if (!list.length) return html`<td class="cell-none" data-label="${label}"><span class="cell-none-text">not run</span></td>`;
      return html`<td data-label="${label}"><div class="strip">${list.map((o) => chipHtml(o, label, caseId))}</div>${excerpt(list)}</td>`;
    });
    return html`<tr>
      <th scope="row" class="case-cell row-head" data-label="Case">
        <div class="case-q" title="${questionText(k)}"><span class="case-id mono">${caseId}</span> ${questionText(k)}</div>
        <div class="case-exp"><span class="label">expected</span> <span class="mono" title="${exp}">${exp || 'none declared'}</span></div>
      </th>
      ${cells}
    </tr>`;
  });

  const empty = html`<div class="empty">${S.only || S.fails ? 'No case matches the filters. Turn a filter off to see all ' + allCases.length + ' cases.' : 'This context declares no cases.'}</div>`;
  setHtml(
    host,
    html`${toolbar}${rows.length
      ? html`<div class="grid-wrap" role="region" aria-label="Answers grid" tabindex="0">
        <table class="ledger ledger-grid" style="--grid-min:${300 + cfgs.length * 230}px">
          <caption class="sr">Answers by case (rows) and configuration (columns). Each cell lists every repeat as a button that opens the inspector, then the text of one answer.</caption>
          <thead><tr><th scope="col" class="case-col">Case, question, expected</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table></div>`
      : empty}`,
  );
}

// Mark the chip whose observation is open in the inspector, without redrawing the grid.
export function syncOpenChip() {
  document.querySelectorAll('.rep-chip').forEach((b) => {
    const on = !!(S.insp && S.insp.obsId === b.dataset.obs);
    b.classList.toggle('is-open', on);
    if (on) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
}
