// Ratings: every rating saved for this test, newest first, with the choice and the notes.
// A rating sits beside the automatic check, never in place of it.
import { S, ctx, cfgOf, chartNames, caseOf } from './model.js';
import { runsOf } from './runs.js';
import { caseName, shortDate, utcTime, plural } from './words.js';
import { html, setHtml } from './util.js';

function ratingsOf(c = ctx()) {
  if (!c || !S.data) return [];
  const ids = new Set(runsOf(c).map((r) => r.run_id));
  return (S.data.annotations || []).filter((a) => ids.has(a.run_id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

// The choice, said from the row's setup: it was answer A in the rating dialog.
function choiceText(a, nameOf) {
  if (!a.pair_choice) return null;
  const other = a.pair_config_id ? nameOf(a.pair_config_id) : 'the other answer';
  if (a.pair_choice === 'tie') return `Same as ${other}`;
  return a.pair_choice === 'A' ? `Better than ${other}` : `${other} was better`;
}

export function renderRatings() {
  const sect = document.getElementById('ratings-sect');
  const host = document.getElementById('ratings');
  const note = document.getElementById('ratings-note');
  if (!sect || !host) return;
  const c = ctx();
  const list = ratingsOf(c);
  sect.hidden = !list.length;
  if (!list.length) {
    setHtml(host, '');
    return;
  }
  if (note) note.textContent = plural(list.length, 'rating');
  const names = chartNames(c.config_ids.map(cfgOf).filter(Boolean));
  const nameOf = (id) => names.get(id) || (cfgOf(id) && cfgOf(id).display_name) || id;
  const nil = html`<span class="nil">–</span>`;
  const rows = list.map((a) => {
    const k = caseOf(a.case_id);
    const choice = choiceText(a, nameOf);
    return html`<tr class="rating-row">
      <th scope="row" class="c-when"><span class="v">${shortDate(a.created_at)}</span><span class="sub">${utcTime(a.created_at)}</span></th>
      <td class="c-case" data-label="Case"><span class="v">${caseName(a.case_id, c.suite.id, k && k.input)}</span><span class="sub">try ${(a.repeat || 0) + 1}</span></td>
      <td class="c-setup" data-label="Setup"><span class="v">${nameOf(a.config_id)}</span></td>
      <td class="c-num" data-label="Rating">${a.value === null || a.value === undefined ? nil : html`<span class="v">${a.value} of 5</span>`}</td>
      <td class="c-choice" data-label="Choice">${choice ? html`<span class="v">${choice}</span>` : nil}</td>
      <td class="c-notes" data-label="Notes">${a.notes ? html`<span class="notes">${a.notes}</span>` : nil}</td>
    </tr>`;
  });
  setHtml(
    host,
    html`<table class="tbl ratings-tbl">
      <caption class="sr">Your ratings of this test, newest first</caption>
      <thead><tr><th scope="col" class="c-when">Rated</th><th scope="col" class="c-case">Case</th><th scope="col" class="c-setup">Setup</th><th scope="col" class="c-num">Rating</th><th scope="col" class="c-choice">Choice</th><th scope="col" class="c-notes">Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`,
  );
}
