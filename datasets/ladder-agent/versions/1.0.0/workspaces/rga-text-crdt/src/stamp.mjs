// Element ids and stamp order. Done; SPEC.md section 1.
const SITE = /^[A-Za-z0-9_-]+$/;
const ID = /^([A-Za-z0-9_-]+)@([1-9][0-9]*)$/;

export const isSite = (value) => typeof value === 'string' && SITE.test(value);
export const elementId = (site, seq) => `${site}@${seq}`;

/** { site, seq } for a well-formed element id, else null. */
export function parseElementId(id) {
  const match = typeof id === 'string' ? ID.exec(id) : null;
  return match ? { site: match[1], seq: Number(match[2]) } : null;
}

/** Negative when stamp a is smaller than b: clock first, then site in code unit order. */
export function compareStamps(a, b) {
  if (a.clock !== b.clock) return a.clock - b.clock;
  if (a.site === b.site) return 0;
  return a.site < b.site ? -1 : 1;
}
