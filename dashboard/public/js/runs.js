// Runs: where the answers of this test came from. One row per run, newest first.
// A run can be scored again from here; a stopped run needs a second click to confirm.
import { S, ctx } from './model.js';
import { shortDate, utcTime, plural } from './words.js';
import { html, setHtml } from './util.js';

// Why a run stopped, in words. The value comes from harness.settings.halted in run.json.
const HALT = { left_workdir: 'the agent wrote outside its folder' };
const haltText = (run) => {
  const why = run && run.harness && run.harness.settings && run.harness.settings.halted;
  return why ? HALT[why] || String(why).replace(/[_-]+/g, ' ') : '';
};

export function runsOf(c = ctx()) {
  if (!c || !S.data) return [];
  const ids = new Set(c.runs.map((r) => (typeof r === 'string' ? r : r.run_id)));
  return (S.data.runs || []).filter((r) => ids.has(r.run_id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

// All or nothing (lab/lib/ledger.mjs): a run that counts in no result says why.
function trustNote(r) {
  const t = r.trust;
  if (!t || (t.state === 'trusted' && t.scores === 'match') || t.state === 'halted' || (r.status === 'running' && r.liveness !== 'stale')) return '';
  let why = 'not counted';
  if (t.state === 'legacy') why = 'not counted: no evidence ledger';
  else if (t.state === 'untrusted') why = /not in the ledger/.test(t.reason || '') ? 'not counted: not in the ledger' : 'not counted: changed since it was written';
  else if (t.state === 'open') why = 'not counted: did not finish';
  else if (t.scores === 'mismatch') why = /no recorded scores/.test(t.scores_reason || '') ? 'not counted: not scored yet' : 'not counted: scores changed';
  return html`<span class="sub warn" title="${t.reason || t.scores_reason || ''}">${why}</span>`;
}

function statusCell(r) {
  const halt = haltText(r);
  if (halt) return html`<span class="state is-warn">Stopped</span><span class="sub">${halt}</span>`;
  if (r.status === 'running' && r.liveness === 'stale') return html`<span class="state is-warn">Stopped without finishing</span>`;
  if (r.status === 'running') return html`<span class="state is-live">Running</span>`;
  if (r.execution_status === 'incomplete') return html`<span class="state is-warn">Incomplete</span><span class="sub">unfinished execution, unjudged</span>`;
  if (r.status === 'failed') return html`<span class="state is-bad">Failed</span>`;
  if (r.rows < r.expected_rows) return html`<span class="state is-warn">Incomplete</span>`;
  return html`<span class="state">Finished</span>`;
}

// armed: the run id waiting for its second click. busy: a job runs, so nothing can start.
export function renderRuns({ armed = '', busy = false } = {}) {
  const host = document.getElementById('runs');
  const note = document.getElementById('runs-note');
  if (!host) return;
  const list = runsOf();
  if (note) note.textContent = plural(list.length, 'run');
  if (!list.length) {
    setHtml(host, html`<p class="quiet-line">No runs stored for this test.</p>`);
    return;
  }
  const rows = list.map((r) => {
    const halt = haltText(r);
    const on = armed === r.run_id;
    const label = halt ? (on ? 'Confirm: score it' : 'Score anyway') : 'Score again';
    const why = busy ? 'Wait for the current job to end.' : halt ? 'This run stopped early. Its files may not match its answers.' : 'Check every answer of this run again. No model is called.';
    const scoreBtn = r.status === 'running'
      ? ''
      : html`<button type="button" class="btn secondary small${on ? ' is-armed' : ''}" data-act="score" data-run="${r.run_id}" data-force="${halt ? '1' : '0'}" data-fk="score:${r.run_id}" title="${why}"${busy ? html` disabled` : ''}>${label}</button>`;
    // A run that stopped without finishing continues: only its missing answers are called.
    const resumeBtn = r.resumable
      ? html`<button type="button" class="btn primary small" data-act="resume" data-run="${r.run_id}" data-fk="resume:${r.run_id}" title="${busy ? 'Wait for the current job to end.' : 'Call only the answers this run is missing.'}"${busy ? html` disabled` : ''}>Resume</button>`
      : '';
    const action = scoreBtn || resumeBtn ? html`${resumeBtn}${scoreBtn}` : html`<span class="nil">–</span>`;
    const answers = Math.max(0, r.rows - r.errors);
    const short = answers < r.expected_rows;
    return html`<tr class="${on ? 'is-armed' : ''}">
      <th scope="row" class="c-when"><span class="v">${shortDate(r.created_at)}</span><span class="sub">${utcTime(r.created_at)}</span></th>
      <td class="c-what" data-label="Experiment"><span class="v">${r.experiment_id || 'no experiment'}</span><span class="sub">${r.harness ? `${r.harness.name} ${r.harness.version}` : 'harness unknown'}</span></td>
      <td class="c-num" data-label="Answers"><span class="v${short ? ' warn' : ''}">${answers} of ${r.expected_rows}</span></td>
      <td class="c-num" data-label="Errors"><span class="v${r.errors > (r.incomplete_n || 0) ? ' bad' : ''}">${r.errors - (r.incomplete_n || 0) || 'none'}</span>${r.incomplete_n ? html`<span class="sub">${r.incomplete_n} unfinished, unjudged</span>` : ''}</td>
      <td class="c-state" data-label="Status">${statusCell(r)}${trustNote(r)}</td>
      <td class="c-act">${action}</td>
    </tr>
    ${on ? html`<tr class="arm-row"><td colspan="6"><p class="arm-note" role="alert">This run stopped early. The agent may have changed files after its last answer. Select <strong>Confirm: score it</strong> to score it anyway.</p></td></tr>` : ''}`;
  });
  setHtml(
    host,
    html`<table class="tbl runs-tbl">
      <caption class="sr">Runs of this test, newest first</caption>
      <thead><tr><th scope="col" class="c-when">Started</th><th scope="col" class="c-what">Experiment</th><th scope="col" class="c-num">Answers</th><th scope="col" class="c-num">Errors</th><th scope="col" class="c-state">Status</th><th scope="col" class="c-act"><span class="sr">Action</span></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <details class="run-ids"><summary class="disclose">Run ids</summary><ul>${list.map((r) => html`<li><code>${r.run_id}</code></li>`)}</ul></details>`,
  );
}
