// Themed dropdown for every <select>. A native select's open list is drawn by the
// operating system and ignores the theme, so each select gets a button and a
// listbox that stand in for its look and its popup. The native select stays in
// the DOM as the source of truth: views keep rendering <option>s, keep setting
// .value, and keep listening for 'change'.
//
// An <option data-sub="…"> gets a second, quieter line in the list and the button.

const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const protoIndex = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
const btnOf = new WeakMap();
let seq = 0;
let open = null; // { sel, btn, pop, active, keyboard }
let typed = '';
let typedAt = 0;
let spaceChoseAt = 0;

const svgCaret = '<svg class="sel-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';
const svgCheck = '<svg class="sel-check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6 9.5 3.4"/></svg>';

function text(el, value) {
  el.textContent = value;
  return el;
}

function span(cls) {
  const s = document.createElement('span');
  s.className = cls;
  return s;
}

function options(sel) {
  return [...sel.options].filter((o) => !o.hidden);
}

// The button shows the chosen option; its name is the select's label plus that value.
function sync(sel) {
  const btn = btnOf.get(sel);
  if (!btn) return;
  const o = sel.selectedOptions[0];
  text(btn.querySelector('.sel-main'), o ? o.textContent : '');
  const sub = btn.querySelector('.sel-sub');
  text(sub, (o && o.dataset.sub) || '');
  sub.hidden = !sub.textContent;
  btn.querySelector('.sel-sep').hidden = sub.hidden;
  btn.disabled = sel.disabled || !sel.options.length;
  btn.title = o ? [o.textContent, o.dataset.sub].filter(Boolean).join(' · ') : '';
  if (open && open.sel === sel) build();
}

function enhance(sel) {
  if (btnOf.has(sel) || sel.multiple || sel.size > 1) return;
  const id = sel.id || `sel-${++seq}`;
  if (!sel.id) sel.id = id;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sel-btn';
  btn.id = `${id}-btn`;
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', `${id}-list`);
  const value = span('sel-value');
  value.id = `${id}-value`;
  // The hidden comma keeps the two lines apart when a screen reader reads the name.
  value.append(span('sel-main'), text(span('sr sel-sep'), ', '), span('sel-sub'));
  btn.append(value);
  btn.insertAdjacentHTML('beforeend', svgCaret);
  // Name: the <label> (or aria-label) first, then the current value.
  const label = sel.labels && sel.labels[0];
  if (label) {
    if (!label.id) label.id = `${id}-label`;
    label.htmlFor = btn.id;
    btn.setAttribute('aria-labelledby', `${label.id} ${value.id}`);
  } else if (sel.getAttribute('aria-label')) {
    const name = span('sr');
    name.id = `${id}-name`;
    text(name, sel.getAttribute('aria-label'));
    btn.append(name);
    btn.setAttribute('aria-labelledby', `${name.id} ${value.id}`);
  }
  sel.classList.add('sel-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');
  sel.after(btn);
  btnOf.set(sel, btn);

  // Code that sets .value or .selectedIndex fires no event; these keep the button in step.
  Object.defineProperty(sel, 'value', { configurable: true, get() { return proto.get.call(this); }, set(v) { proto.set.call(this, v); sync(this); } });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return protoIndex.get.call(this); }, set(v) { protoIndex.set.call(this, v); sync(this); } });
  new MutationObserver(() => sync(sel)).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected', 'data-sub', 'label'] });
  sel.addEventListener('change', () => sync(sel));
  sel.addEventListener('focus', () => btn.focus());

  btn.addEventListener('click', () => (open && open.sel === sel ? close(true) : show(sel, false)));
  btn.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    show(sel, true, e.key === 'Home' ? 'first' : e.key === 'End' || (e.key === 'ArrowUp' && !e.altKey) ? 'last-or-current' : 'current');
    if (e.key === 'End' && open) { const all = rows(); if (all.length) activate(Number(all[all.length - 1].dataset.index)); }
  });
  // A Space that chose an option must not click the button open again on keyup (Firefox).
  btn.addEventListener('click', (e) => {
    if (Date.now() - spaceChoseAt < 400) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  sync(sel);
}

function build() {
  const { sel, pop } = open;
  pop.textContent = '';
  const cur = sel.selectedIndex;
  options(sel).forEach((o, i) => {
    const row = document.createElement('div');
    row.className = 'sel-opt';
    row.id = `${sel.id}-opt-${o.index}`;
    row.setAttribute('role', 'option');
    row.dataset.index = String(o.index);
    row.setAttribute('aria-selected', String(o.index === cur));
    if (o.disabled) row.setAttribute('aria-disabled', 'true');
    const body = span('sel-opt-text');
    body.append(text(span('sel-opt-main'), o.textContent));
    if (o.dataset.sub) body.append(text(span('sel-opt-sub'), o.dataset.sub));
    row.insertAdjacentHTML('afterbegin', svgCheck);
    row.append(body);
    pop.append(row);
    if (i === 0 && open.active == null) open.active = o.index;
  });
  activate(open.active, false);
}

function rows() {
  return open ? [...open.pop.querySelectorAll('.sel-opt:not([aria-disabled="true"])')] : [];
}

function activate(index, scroll = true) {
  if (!open) return;
  open.active = index;
  let hit = null;
  open.pop.querySelectorAll('.sel-opt').forEach((r) => {
    const on = Number(r.dataset.index) === index;
    r.classList.toggle('is-active', on);
    if (on) hit = r;
  });
  if (hit) {
    open.pop.setAttribute('aria-activedescendant', hit.id);
    if (scroll) hit.scrollIntoView({ block: 'nearest' });
  } else open.pop.removeAttribute('aria-activedescendant');
}

// Fixed position, so a scrolling rail or a table frame never clips the list.
// It opens below the button, or above when there is more room there.
function place() {
  if (!open) return;
  const { btn, pop } = open;
  const r = btn.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(r.width, Number(pop.dataset.natural) || 0), 560, vw - 16);
  pop.style.minWidth = `${Math.min(r.width, vw - 16)}px`;
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, vw - width - 8))}px`;
  const below = vh - r.bottom - 12;
  const above = r.top - 12;
  const up = below < 200 && above > below;
  pop.style.maxHeight = `${Math.max(120, Math.min(360, up ? above : below))}px`;
  pop.classList.toggle('is-up', up);
  if (up) {
    pop.style.top = '';
    pop.style.bottom = `${vh - r.top + 6}px`;
  } else {
    pop.style.bottom = '';
    pop.style.top = `${r.bottom + 6}px`;
  }
}

function show(sel, keyboard, start = 'current') {
  if (open) close(false);
  const btn = btnOf.get(sel);
  if (!btn || btn.disabled) return;
  const pop = document.createElement('div');
  pop.className = 'sel-pop';
  pop.id = `${sel.id}-list`;
  pop.setAttribute('role', 'listbox');
  pop.tabIndex = -1;
  pop.setAttribute('aria-labelledby', btn.getAttribute('aria-labelledby') || btn.id);
  // A keyboard open is instant; a pointer open eases in.
  if (keyboard || matchMedia('(prefers-reduced-motion: reduce)').matches) pop.classList.add('is-instant');
  open = { sel, btn, pop, active: sel.selectedIndex >= 0 ? sel.selectedIndex : null, keyboard };
  build();
  if (start === 'first') {
    const all = rows();
    if (all.length) open.active = Number(all[0].dataset.index);
  }
  if (start === 'last-or-current' && sel.selectedIndex < 0) {
    const all = rows();
    if (all.length) activate(Number(all[all.length - 1].dataset.index));
  }
  document.body.append(pop);
  pop.style.width = 'max-content';
  pop.dataset.natural = String(Math.ceil(pop.scrollWidth) + 2);
  place();
  btn.setAttribute('aria-expanded', 'true');
  pop.addEventListener('keydown', onKey);
  pop.addEventListener('pointermove', (e) => {
    const r = e.target.closest('.sel-opt:not([aria-disabled="true"])');
    if (r && Number(r.dataset.index) !== open.active) activate(Number(r.dataset.index), false);
  });
  pop.addEventListener('click', (e) => {
    const r = e.target.closest('.sel-opt:not([aria-disabled="true"])');
    if (r) choose(Number(r.dataset.index));
  });
  pop.focus({ preventScroll: true });
  activate(open.active);
  requestAnimationFrame(() => pop.classList.add('is-in'));
}

function close(focusButton) {
  if (!open) return;
  const { sel, btn, pop } = open;
  const hadFocus = pop.contains(document.activeElement);
  open = null;
  pop.remove();
  btn.setAttribute('aria-expanded', 'false');
  if (focusButton || hadFocus) refocus(sel.id);
}

// The button now, and again after the next task: a 'change' handler may re-render
// the view and replace the select, and the new button exists only after the
// observer runs. Never steal focus that already moved somewhere real.
function refocus(id) {
  const go = () => {
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected) return;
    const b = document.getElementById(`${id}-btn`);
    if (b) b.focus({ preventScroll: true });
  };
  const b = document.getElementById(`${id}-btn`);
  if (b) b.focus({ preventScroll: true });
  setTimeout(go, 0);
}

function choose(index) {
  const { sel } = open;
  const changed = sel.selectedIndex !== index;
  close(true);
  if (!changed) return;
  protoIndex.set.call(sel, index);
  sync(sel);
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  refocus(sel.id);
}

function onKey(e) {
  const all = rows();
  const at = all.findIndex((r) => Number(r.dataset.index) === open.active);
  const go = (i) => all.length && activate(Number(all[Math.max(0, Math.min(all.length - 1, i))].dataset.index));
  let handled = true;
  // Type to jump: keys typed within half a second build one search, Space included.
  const search = (key) => {
    const now = Date.now();
    typed = now - typedAt < 500 ? typed + key.toLowerCase() : key.toLowerCase();
    typedAt = now;
    const from = typed.length === 1 ? at + 1 : at;
    const order = [...all.slice(Math.max(0, from)), ...all.slice(0, Math.max(0, from))];
    const hit = order.find((r) => r.textContent.trim().toLowerCase().startsWith(typed));
    if (hit) activate(Number(hit.dataset.index));
  };
  switch (e.key) {
    case 'ArrowDown': go(at < 0 ? 0 : at + 1); break;
    case 'ArrowUp': go(at < 0 ? all.length - 1 : at - 1); break;
    case 'Home': go(0); break;
    case 'End': go(all.length - 1); break;
    case 'PageDown': go(at + 8); break;
    case 'PageUp': go(at - 8); break;
    case ' ':
      if (Date.now() - typedAt < 500) { search(' '); break; }
      spaceChoseAt = Date.now();
      if (open.active != null && at >= 0) choose(open.active);
      else close(true);
      break;
    case 'Enter':
      if (open.active != null && at >= 0) choose(open.active);
      else close(true);
      break;
    case 'Escape': close(true); break;
    case 'Tab': close(true); handled = false; break;
    default:
      handled = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (handled) search(e.key);
  }
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

/** Enhance every select now, and every select a later render adds. */
export function wireSelects(root = document) {
  root.querySelectorAll('select').forEach(enhance);
  new MutationObserver((list) => {
    for (const m of list) {
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'SELECT') enhance(n);
        else n.querySelectorAll && n.querySelectorAll('select').forEach(enhance);
      });
    }
    // A re-render that removed the open select also closes its list.
    if (open && !open.sel.isConnected) close(false);
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', (e) => {
    if (!open || open.pop.contains(e.target) || open.btn.contains(e.target)) return;
    const focusable = e.target.closest && e.target.closest('a[href], button, input, select, textarea, summary, [tabindex]');
    close(!focusable);
  }, true);
  window.addEventListener('resize', () => close(true));
  document.addEventListener('scroll', (e) => {
    if (open && !open.pop.contains(e.target)) place();
  }, true);
}
