// Configurations panel and the tray (the ordered selection).
import { S, MAX_SELECTED, ctx, cfgOf, selectedCfgs, letterOf } from './model.js';
import { html, raw, setHtml, dateOnly } from './util.js';

const norm = (s) => String(s ?? '').toLowerCase();

function haystack(c) {
  return norm([c.display_name, c.model_key, c.model, c.provider, c.harness.name, c.harness.version, c.effort || 'default', c.access_method].join(' '));
}

const effortText = (c) => (c.effort ? `effort ${c.effort}` : 'default effort');

export function cfgShort(c) {
  return html`${c.harness.name} <span class="mono">${c.harness.version}</span> · ${c.effort || 'default'}`;
}

export function cfgVer(c) {
  return html`<span class="mono">${c.harness.version}</span> · ${c.effort || 'default'} effort`;
}

export function cfgSub(c) {
  return html`${c.harness.name} <span class="mono">${c.harness.version}</span> · ${effortText(c)} · ${c.access_method}`;
}

function chipRow(label, act, values, active) {
  return html`<div class="fgroup" role="group" aria-label="${label}"><span class="fgroup-label">${label}</span><div class="fchips">${values.map(([v, n]) => html`<button type="button" class="ctl" data-act="${act}" data-value="${v}" data-fk="${act}:${v}" aria-pressed="${String(active.includes(v))}">${v} <span class="num">${n}</span></button>`)}</div></div>`;
}

export function renderConfigPanel() {
  const c = ctx();
  const list = document.getElementById('cfg-list');
  const count = document.getElementById('cfg-count');
  const toggle = document.getElementById('cfg-toggle');
  const body = document.getElementById('cfg-body');
  const filters = document.getElementById('cfg-filters');
  if (!c) {
    setHtml(list, html`<div class="empty">No configurations yet. Run <code>node lab run experiments/smoke-harness-sweep.yaml</code>, then Refresh.</div>`);
    setHtml(filters, '');
    count.textContent = '';
    toggle.textContent = 'Lineup';
    return;
  }
  const ids = c.config_ids.filter((id) => cfgOf(id));
  const all = ids.map(cfgOf);
  const tally = (fn) => {
    const m = new Map();
    all.forEach((x) => m.set(fn(x), (m.get(fn(x)) || 0) + 1));
    return [...m.entries()].sort((p, q) => String(p[0]).localeCompare(String(q[0])));
  };
  const harnesses = tally((x) => x.harness.name);
  const providers = tally((x) => x.provider);
  S.fHarness = S.fHarness.filter((v) => harnesses.some(([h]) => h === v));
  S.fProvider = S.fProvider.filter((v) => providers.some(([p]) => p === v));
  setHtml(filters, html`${harnesses.length > 1 ? chipRow('Harness', 'f-harness', harnesses, S.fHarness) : ''}${providers.length > 1 ? chipRow('Provider', 'f-provider', providers, S.fProvider) : ''}`);
  toggle.textContent = `Lineup · ${S.sel.length} of ${MAX_SELECTED} selected`;
  toggle.setAttribute('aria-expanded', String(S.cfgOpen));
  body.classList.toggle('is-open', S.cfgOpen);
  const q = norm(S.cfgQuery).trim();
  const shown = all.filter((x) => (!S.fHarness.length || S.fHarness.includes(x.harness.name)) && (!S.fProvider.length || S.fProvider.includes(x.provider)) && (!q || q.split(/\s+/).every((t) => haystack(x).includes(t))));
  count.textContent = shown.length === ids.length ? `${ids.length} in this context` : `${shown.length} of ${ids.length} shown`;
  const full = S.sel.length >= MAX_SELECTED;
  if (!shown.length) {
    setHtml(list, html`<div class="cfg-none">No configuration matches the filters. Clear the search or the chips to see all ${ids.length}.</div>`);
    return;
  }
  const groups = new Map();
  shown.forEach((x) => {
    if (!groups.has(x.provider)) groups.set(x.provider, []);
    groups.get(x.provider).push(x);
  });
  const note = full ? html`<div class="cfg-full" id="cfg-full">The lineup holds ${MAX_SELECTED}. Remove one to add another.</div>` : '';
  setHtml(
    list,
    html`${note}${[...groups.keys()].sort().map((provider) => {
      const items = groups.get(provider);
      return html`<div class="cfg-group">
        <div class="cfg-group-head"><h3>${provider}</h3><span class="num label">${items.length}</span></div>
        <ul class="cfg-list" aria-label="${provider} configurations">${items.map((x) => {
          const on = S.sel.includes(x.id);
          const blocked = !on && full;
          const verb = on ? 'Remove' : 'Add';
          return html`<li class="cfg-row${on ? ' is-selected' : ''}" draggable="true" data-cfg="${x.id}">
            <div class="cfg-info">
              <span class="cfg-name">${x.display_name}</span>
              <span class="cfg-sub">${cfgSub(x)}</span>
            </div>
            <button type="button" class="ctl cfg-toggle-btn" data-act="cfg-pick" data-cfg="${x.id}" data-fk="cfg:${x.id}" aria-label="${verb} ${x.display_name}, ${x.harness.name} ${x.harness.version}, ${effortText(x)}${blocked ? ' (lineup full)' : ''}"${blocked ? raw(' disabled aria-describedby="cfg-full"') : ''}>${verb}</button>
          </li>`;
        })}</ul>
      </div>`;
    })}`,
  );
}

export function renderTray() {
  const host = document.getElementById('tray');
  const note = document.getElementById('tray-note');
  const cfgs = selectedCfgs();
  note.textContent = `${cfgs.length} / ${MAX_SELECTED}`;
  if (!ctx()) {
    setHtml(host, html`<div class="empty">Nothing to select yet. Run <code>node lab run experiments/smoke-harness-sweep.yaml</code>, then Refresh.</div>`);
    return;
  }
  if (!cfgs.length) {
    setHtml(host, html`<div class="empty" data-drop="tray">Empty. Add a configuration below, or drag one here.</div>`);
    return;
  }
  setHtml(
    host,
    html`<ol class="tray-list" data-drop="tray" aria-label="Selected configurations in column order">${cfgs.map((x, i) => html`<li class="chip" draggable="true" data-cfg="${x.id}">
      <span class="lt" aria-hidden="true">${letterOf(x.id)}</span>
      <span class="chip-text" title="${x.display_name}, ${x.harness.name} ${x.harness.version}, ${effortText(x)}, ${x.access_method}"><span class="chip-name">${x.display_name}</span><span class="chip-sub">${x.harness.name} <span class="mono">${x.harness.version}</span>${x.effort ? ` · ${x.effort}` : ''}</span></span>
      <div class="chip-tools">
        <button type="button" class="icon-ctl" data-act="tray-left" data-cfg="${x.id}" data-fk="tray:${x.id}:left" aria-label="Move ${x.display_name} earlier"${i === 0 ? raw(' disabled') : ''}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 9.5v-7M3 5.5l3-3 3 3" class="ico"/></svg></button>
        <button type="button" class="icon-ctl" data-act="tray-right" data-cfg="${x.id}" data-fk="tray:${x.id}:right" aria-label="Move ${x.display_name} later"${i === cfgs.length - 1 ? raw(' disabled') : ''}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v7M3 6.5l3 3 3-3" class="ico"/></svg></button>
        <button type="button" class="icon-ctl" data-act="tray-remove" data-cfg="${x.id}" data-fk="tray:${x.id}:remove" aria-label="Remove ${x.display_name}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" class="ico"/></svg></button>
      </div>
    </li>`)}</ol>`,
  );
}

// Selection operations. Each returns an announcement, or null when nothing changed.
export function addCfg(id) {
  if (S.sel.includes(id)) return null;
  if (S.sel.length >= MAX_SELECTED) return `The lineup is full. Remove a configuration to add another.`;
  S.sel.push(id);
  return `Added ${cfgOf(id).display_name}. ${S.sel.length} selected, position ${S.sel.length}.`;
}
export function removeCfg(id) {
  const i = S.sel.indexOf(id);
  if (i < 0) return null;
  S.sel.splice(i, 1);
  return `Removed ${cfgOf(id).display_name}. ${S.sel.length} selected.`;
}
export function moveCfg(id, delta) {
  const i = S.sel.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= S.sel.length) return null;
  S.sel.splice(i, 1);
  S.sel.splice(j, 0, id);
  return `Moved ${cfgOf(id).display_name} to position ${j + 1} of ${S.sel.length}.`;
}
export function placeCfg(id, index) {
  const was = S.sel.indexOf(id);
  if (was >= 0) {
    S.sel.splice(was, 1);
    S.sel.splice(Math.min(index > was ? index - 1 : index, S.sel.length), 0, id);
    return `Moved ${cfgOf(id).display_name} to position ${S.sel.indexOf(id) + 1} of ${S.sel.length}.`;
  }
  if (S.sel.length >= MAX_SELECTED) return 'The lineup is full. Remove a configuration to add another.';
  S.sel.splice(Math.min(index, S.sel.length), 0, id);
  return `Added ${cfgOf(id).display_name} at position ${S.sel.indexOf(id) + 1} of ${S.sel.length}.`;
}
