// Small shared UI helpers: live region, status place, focus restore, motion preference.

const live = () => document.getElementById('live');
let liveTimer = 0;

// Announce a change to assistive technology. A repeated message is still read.
export function announce(message) {
  const el = live();
  if (!el) return;
  clearTimeout(liveTimer);
  el.textContent = '';
  liveTimer = setTimeout(() => {
    el.textContent = message;
  }, 30);
}

let statusTimer = 0;

// The one status place, next to the controls it reports on.
export function setStatus(message, kind = '') {
  const el = document.getElementById('status');
  if (!el) return;
  clearTimeout(statusTimer);
  el.classList.remove('is-on');
  el.classList.toggle('is-error', kind === 'error');
  el.textContent = message;
  if (!message) return;
  void el.offsetWidth;
  el.classList.add('is-on');
  announce(message);
  if (kind !== 'error') {
    statusTimer = setTimeout(() => {
      el.classList.remove('is-on');
    }, 6000);
  }
}

export const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Keep focus on the same control across a re-render. Controls carry data-fk.
export function captureFocus() {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  const host = a.closest('[data-fk]');
  if (!host) return null;
  return { key: host.getAttribute('data-fk'), inside: host !== a ? a.tagName : null };
}

export function restoreFocus(saved, fallbacks = []) {
  if (!saved) return;
  const find = (k) => document.querySelector(`[data-fk="${CSS.escape(k)}"]`);
  const order = [saved.key, ...fallbacks];
  for (const key of order) {
    const el = find(key);
    if (el && !el.disabled && el.offsetParent !== null) {
      el.focus({ preventScroll: true });
      return;
    }
  }
}

export function focusableIn(root) {
  return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

// Trap Tab inside a container.
export function trapTab(event, root) {
  if (event.key !== 'Tab') return;
  const items = focusableIn(root);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
