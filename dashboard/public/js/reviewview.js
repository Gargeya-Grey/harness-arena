// Review view: start a blind review and read back the ratings stored for this context.
import { S, ctx, cfgOf, selectedCfgs, cellObs, chartNames } from './model.js';
import { html, raw, setHtml, dateTime } from './util.js';

// The observation a review of this case starts from: the first selected configuration that has an answer.
export function reviewStartObs(caseId) {
  for (const id of S.sel) {
    const list = cellObs(caseId, id);
    const hit = list.find((o) => o.status !== 'error') || list[0];
    if (hit) return hit;
  }
  return null;
}

export function renderReviewView() {
  const host = document.getElementById('rev-body');
  const note = document.getElementById('rev-note');
  const c = ctx();
  if (!c) {
    note.textContent = '';
    setHtml(host, html`<div class="empty">No runs yet. Run <code>node lab run experiments/smoke-harness-sweep.yaml</code>, then Refresh.</div>`);
    return;
  }
  const cfgs = selectedCfgs();
  const names = chartNames(cfgs);
  const runIds = new Set(((S.data && S.data.runs) || []).filter((r) => r.context_key === c.key).map((r) => r.run_id));
  const list = ((S.data && S.data.annotations) || []).filter((a) => runIds.has(a.run_id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  note.textContent = `n = ${list.length} rating${list.length === 1 ? '' : 's'} in this context`;
  const cases = c.cases.filter((id) => reviewStartObs(id));
  if (!cases.includes(S.revCase)) S.revCase = cases[0] || '';
  const label = (id) => {
    if (names.has(id)) return names.get(id);
    const x = cfgOf(id);
    return x ? `${x.display_name} (${x.harness.name} ${x.harness.version})` : id;
  };
  const start = cases.length
    ? html`<div class="rev-actions">
        <div class="field"><label class="field-label" for="rev-case">Case to review</label>
          <select id="rev-case">${cases.map((id) => html`<option value="${id}"${id === S.revCase ? raw(' selected') : ''}>${id}</option>`)}</select></div>
        <button type="button" class="btn" data-act="review-start" data-fk="review:start">Start blind review</button>
      </div>
      <p class="label">The review shows two answers with the configuration names hidden. Names appear after you save.</p>`
    : html`<div class="empty">No selected configuration has an answer to review. Select configurations in the rail.</div>`;
  const pairText = (a) => {
    if (!a.pair_choice) return html`<span class="muted">none</span>`;
    const first = label(a.config_id);
    const second = a.pair_config_id ? label(a.pair_config_id) : 'unknown';
    if (a.pair_choice === 'tie') return `tie: ${first} and ${second}`;
    return a.pair_choice === 'A' ? `${first} over ${second}` : `${second} over ${first}`;
  };
  const rows = list.map((a) => html`<tr>
    <td data-label="When"><time class="mono" datetime="${a.created_at}">${dateTime(a.created_at)}</time></td>
    <td data-label="Case"><span class="mono">${a.case_id}</span></td>
    <td data-label="Configuration">${label(a.config_id)}<span class="cell-sub mono">r${a.repeat}</span></td>
    <td data-label="Rating" class="col-num">${a.value === null ? html`<span class="muted">none</span>` : html`<span class="num">${a.value}</span> of 5`}</td>
    <td data-label="Pairwise">${pairText(a)}</td>
    <td data-label="Notes">${a.notes || html`<span class="muted">none</span>`}</td>
  </tr>`);
  const table = list.length
    ? html`<div class="runs-wrap" role="region" aria-label="Ratings table" tabindex="0"><table class="ledger ledger-rev">
        <caption class="sr">Human ratings for this context, newest first</caption>
        <thead><tr><th scope="col">When (UTC)</th><th scope="col">Case</th><th scope="col">Configuration</th><th scope="col" class="col-num">Rating</th><th scope="col">Pairwise</th><th scope="col">Notes</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : html`<div class="empty">No ratings for this context yet.</div>`;
  setHtml(host, html`${start}${table}`);
}
