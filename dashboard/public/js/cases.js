// Case by case: one row per case, one column per shown setup, one mark per try.
// A mark opens that try in the side panel. Marks differ by shape as well as colour.
import { S, ctx, shownSetups, cellObs, caseOf, outcome, letterOf, onlyOn, repeatsOf } from './model.js';
import { caseName, caseHint, plural } from './words.js';
import { html, setHtml } from './util.js';

// Setups differ on a case when their counts of passed, failed, no answer and not checked differ.
function caseDiffers(caseId, ids) {
  const sig = (id) => {
    const n = { pass: 0, fail: 0, error: 0, incomplete: 0, unscored: 0 };
    for (const o of cellObs(caseId, id)) n[outcome(o).kind] += 1;
    return `${n.pass}/${n.fail}/${n.error}/${n.incomplete}/${n.unscored}`;
  };
  return new Set(ids.map(sig)).size > 1;
}

// Does any shown setup have a scored try on any case? Without one, "the setups agree" says nothing.
export function anyScored(caseIds, ids) {
  return caseIds.some((caseId) => ids.some((id) => cellObs(caseId, id).some((o) => outcome(o).kind === 'pass' || outcome(o).kind === 'fail')));
}

const markHtml = (o, who, caseText, total) => {
  const out = outcome(o);
  const label = `${who}, ${caseText}, try ${o.repeat + 1}${total > 1 ? ` of ${total}` : ''}: ${out.text}`;
  return html`<button type="button" class="tm tm-${out.kind}" data-act="inspect" data-obs="${o.id}" data-fk="tm:${o.id}" aria-label="${label}" title="${label}"><span aria-hidden="true">${out.glyph}</span></button>`;
};

export function renderCases() {
  const host = document.getElementById('cases');
  const note = document.getElementById('cases-note');
  const toggle = document.getElementById('only-btn');
  const c = ctx();
  if (!c) return;
  const setups = shownSetups();
  const ids = setups.map((s) => s.id);
  const multi = setups.length > 1;
  const scored = anyScored(c.cases, ids);
  // Without a score no case can differ, so the filter and the agreement line have nothing to say.
  const differing = multi ? c.cases.filter((id) => caseDiffers(id, ids)) : c.cases;
  const only = multi && scored && onlyOn();
  const shown = only ? differing : c.cases;
  const total = repeatsOf(c);
  toggle.hidden = !multi || !scored;
  toggle.setAttribute('aria-checked', String(only));
  note.textContent = multi ? (only ? `${differing.length} of ${plural(c.cases.length, 'case')} differ` : plural(c.cases.length, 'case')) : plural(c.cases.length, 'case');
  if (!shown.length) {
    setHtml(host, scored ? html`<p class="quiet-line">The setups agree on every case. <button type="button" class="link-btn" data-act="only" data-fk="only-all">Show all cases</button></p>` : html`<p class="quiet-line">This test has no cases.</p>`);
    host.classList.add('is-empty');
    return;
  }
  host.classList.remove('is-empty');
  const rows = shown.map((id) => {
    const k = caseOf(id);
    const name = caseName(id, c.suite.id, k && k.input);
    const hint = caseHint(k && k.input);
    const cells = setups.map((s) => {
      const list = cellObs(id, s.id);
      const who = s.name;
      return html`<td class="c-try">
        ${multi ? html`<span class="cell-who"><span class="lt" aria-hidden="true">${letterOf(s.id)}</span>${s.name}</span>` : ''}
        <span class="marks">${list.length ? list.map((o) => markHtml(o, who, name, total)) : html`<span class="tm tm-none" title="Not run" aria-label="${who}: not run"><span aria-hidden="true">–</span></span>`}</span>
      </td>`;
    });
    return html`<tr><th scope="row" class="c-case"><span class="case-name">${name}</span>${hint && hint !== name ? html`<span class="case-hint">${hint}</span>` : ''}</th>${cells}</tr>`;
  });
  const head = multi
    ? setups.map((s) => html`<th scope="col" class="c-try"><span class="col-who"><span class="lt" aria-hidden="true">${letterOf(s.id)}</span><span class="col-name">${s.name}</span></span></th>`)
    : html`<th scope="col" class="c-try">${total > 1 ? 'Tries' : 'Try'}</th>`;
  setHtml(
    host,
    html`<table class="tbl cases-tbl${multi ? '' : ' is-single'}" style="--setups:${setups.length}">
      <caption class="sr">Each case and the result of every try. Select a mark to read that answer.</caption>
      <thead><tr><th scope="col" class="c-case">Case</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`,
  );
  syncOpenMark();
}

// The mark of the try open in the side panel carries the current-item ring.
export function syncOpenMark() {
  document.querySelectorAll('.tm.is-open').forEach((el) => el.classList.remove('is-open'));
  if (!S.insp) return;
  const el = document.querySelector(`.tm[data-obs="${CSS.escape(S.insp.obsId)}"]`);
  if (el) el.classList.add('is-open');
}
