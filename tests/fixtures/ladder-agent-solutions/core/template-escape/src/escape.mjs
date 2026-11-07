// A SafeString is markup that is already trusted: it is written out as it is.
export class SafeString {
  constructor(value) {
    this.value = String(value);
  }

  toString() {
    return this.value;
  }
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

// What an escaped tag writes for a value.
export function emit(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof SafeString) return value.toString();
  return escapeHtml(value);
}
