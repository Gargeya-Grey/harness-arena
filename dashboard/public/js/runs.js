// Runs: a ledger of every run in every context, then the schema problems.
import { S } from './model.js';
import { html, setHtml, dateTime } from './util.js';

export function renderRuns() {
  const host = document.getElementById('runs-body');
  const note = document.getElementById('runs-note');
  const d = S.data;
  const runs = d ? d.runs || [] : [];
  const problems = d ? d.problems || [] : [];
  const statuses = [...new Set(runs.map((r) => r.status))].sort();
  if (S.runStatus !== 'all' && !statuses.includes(S.runStatus)) S.runStatus = 'all';
  const shownRuns = S.runStatus === 'all' ? runs : runs.filter((r) => r.status === S.runStatus);
  note.textContent = runs.length ? `n = ${shownRuns.length} of ${runs.length} run${runs.length === 1 ? '' : 's'}, newest first. Select a start time to open its context.` : '';
  const filter = runs.length ? html`<div class="toolbar" role="group" aria-label="Status filter"><span class="label">Status</span>${['all', ...statuses].map((st) => html`<button type="button" class="ctl" data-act="run-status" data-value="${st}" data-fk="run-status:${st}" aria-pressed="${String(S.runStatus === st)}">${st === 'all' ? 'All' : st} <span class="num">${st === 'all' ? runs.length : runs.filter((r) => r.status === st).length}</span></button>`)}</div>` : '';
  let table;
  if (!runs.length) {
    table = html`<div class="empty">No runs yet. Run <code>node lab run experiments/smoke-harness-sweep.yaml</code>, then Refresh.</div>`;
  } else {
    const rows = shownRuns.map((r) => {
      const incomplete = r.rows < r.expected_rows;
      const badStatus = r.status !== 'completed';
      return html`<tr>
        <td data-label="Started"><button type="button" class="link-btn" data-act="open-run" data-run="${r.run_id}" data-fk="run:${r.run_id}" aria-label="Open run from ${dateTime(r.created_at)}, ${r.experiment_id || r.run_id}"><time class="mono" datetime="${r.created_at}">${dateTime(r.created_at)}</time></button></td>
        <td data-label="Experiment">${r.experiment_id || html`<span class="muted">none</span>`}
          <details class="run-details"><summary>Run details<span class="sr"> for ${r.run_id}</span></summary>
            <dl><dt>Run ID</dt><dd class="mono">${r.run_id}</dd><dt>Harness</dt><dd>${r.harness ? html`${r.harness.name} <span class="mono">${r.harness.version}</span>` : 'unknown'}</dd><dt>Models</dt><dd>${(r.models || []).join(', ') || 'none'}</dd></dl>
          </details></td>
        <td data-label="Harness" class="run-harness">${r.harness ? html`${r.harness.name} <span class="mono">${r.harness.version}</span>` : html`<span class="muted">unknown</span>`}</td>
        <td data-label="Models" class="run-models">${(r.models || []).join(', ') || html`<span class="muted">none</span>`}</td>
        <td data-label="Rows" class="col-num"><span class="num${incomplete ? ' bad' : ''}">${r.rows} / ${r.expected_rows}</span></td>
        <td data-label="Errors" class="col-num"><span class="num${r.errors ? ' bad' : ''}">${r.errors}</span></td>
        <td data-label="Status" class="run-status"><span class="pill${badStatus ? ' is-bad' : ''}">${r.status}</span></td>
      </tr>`;
    });
    table = html`<div class="runs-wrap" role="region" aria-label="Runs table" tabindex="0"><table class="ledger ledger-runs">
      <caption class="sr">All runs, newest first</caption>
      <thead><tr><th scope="col">Started (UTC)</th><th scope="col">Experiment</th><th scope="col" class="run-harness">Harness</th><th scope="col" class="run-models">Models</th><th scope="col" class="col-num">Rows</th><th scope="col" class="col-num">Errors</th><th scope="col" class="run-status">Status</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  const prob = problems.length
    ? html`<div class="problems"><h3 class="bad">Problems (${problems.length})</h3>
        <div class="runs-wrap" role="region" aria-label="Problems table" tabindex="0"><table class="ledger ledger-problems">
          <caption class="sr">Records that failed to parse or validate</caption>
          <thead><tr><th scope="col">File</th><th scope="col">Message</th></tr></thead>
          <tbody>${problems.map((p) => html`<tr><td data-label="File"><span class="mono problem-file">${p.file}</span></td><td data-label="Message"><span class="problem-msg">${p.message}</span></td></tr>`)}</tbody></table></div></div>`
    : html`<div class="problems problems-ok">All records valid against the schemas.</div>`;
  setHtml(host, html`${filter}${table}${prob}`);
}
