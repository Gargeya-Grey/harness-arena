// Shared helpers: safe HTML templates and number formatting.

class Safe {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (text) => new Safe(String(text ?? ''));
// A "·" list as HTML that breaks only between its parts; a long part (a case name) may still wrap.
export const keepParts = (text) => String(text).split(' · ').map((p) => (p.length <= 24 ? `<span class="keep">${esc(p)}</span>` : esc(p))).join(' · ');

function part(value) {
  if (value instanceof Safe) return value.text;
  if (Array.isArray(value)) return value.map(part).join('');
  if (value === null || value === undefined || value === false) return '';
  return esc(value);
}

// Tagged template: interpolated values are escaped unless they are Safe or arrays of Safe.
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += part(values[i]);
  });
  return new Safe(out);
}

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const NA = 'n/a';

export function setHtml(el, content) {
  if (el) el.innerHTML = String(content);
}

export function usdText(v, fallback = NA) {
  if (!isNum(v)) return fallback;
  if (v === 0) return '$0';
  // Below a tenth of a cent, keep two significant digits, so a tiny cost never prints as $0.0000.
  const digits = v >= 1 ? 2 : v >= 0.1 ? 3 : v >= 0.001 ? 4 : Math.min(8, 1 - Math.floor(Math.log10(Math.abs(v))));
  return `$${v.toFixed(digits)}`;
}
export function tokText(v, fallback = NA) {
  if (!isNum(v)) return fallback;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)}k`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function dateTime(iso) {
  if (!iso) return NA;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}Z` : String(iso);
}

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'model-lab';
}

export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
