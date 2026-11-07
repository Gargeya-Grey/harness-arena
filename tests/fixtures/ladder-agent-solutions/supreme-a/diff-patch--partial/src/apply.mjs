import { parsePatch } from './parse.mjs';
import { splitLines, joinLines } from './lines.mjs';

const FLIP = { equal: 'equal', delete: 'insert', insert: 'delete' };

function backwards(hunk) {
  return {
    oldStart: hunk.newStart,
    oldCount: hunk.newCount,
    newStart: hunk.oldStart,
    newCount: hunk.oldCount,
    lines: hunk.lines.map((item) => ({ type: FLIP[item.type], line: item.line })),
  };
}

export function applyPatch(text, patch, options = {}) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const parsed = typeof patch === 'string' ? parsePatch(patch) : patch;
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.hunks)) throw new TypeError('patch must be a string or a parsed patch');
  const { fuzz = 0, reverse = false } = options;
  if (!Number.isInteger(fuzz) || fuzz < 0) throw new RangeError('fuzz must be an integer >= 0');

  const file = splitLines(text);
  const placed = [];
  let minPlace = 1;
  let shift = 0;
  for (let index = 0; index < parsed.hunks.length; index += 1) {
    const hunk = reverse ? backwards(parsed.hunks[index]) : parsed.hunks[index];
    const old = hunk.lines.filter((item) => item.type !== 'insert').map((item) => item.line);
    let lead = 0;
    while (lead < hunk.lines.length && hunk.lines[lead].type === 'equal') lead += 1;
    let trail = 0;
    if (lead < hunk.lines.length) while (hunk.lines[hunk.lines.length - 1 - trail].type === 'equal') trail += 1;
    const expected = hunk.oldCount === 0 ? hunk.oldStart + 1 : hunk.oldStart;
    const lastPlace = file.length - old.length + 1;
    const firstPlace = Math.max(1, minPlace);
    const base = expected + shift;

    let found = null;
    for (let level = 0; level <= fuzz && found === null; level += 1) {
      const head = Math.min(level, lead);
      const tail = 0;
      const fits = (place) => {
        for (let i = head; i < old.length - tail; i += 1) if (file[place - 1 + i] !== old[i]) return false;
        return true;
      };
      let s = base > lastPlace ? base - lastPlace : base < firstPlace ? firstPlace - base : 0;
      for (; found === null && (base + s <= lastPlace || base - s >= firstPlace); s += 1) {
        for (const place of s === 0 ? [base] : [base - s, base + s]) {
          if (place >= firstPlace && place <= lastPlace && fits(place)) {
            found = { place, level };
            break;
          }
        }
      }
    }
    if (found === null) return { ok: false, hunk: index };
    const offset = found.place - expected;
    placed.push({ hunk, old: old.length, start: found.place, offset, fuzz: found.level });
    shift = 0;
    minPlace = found.place + old.length;
  }

  const out = [];
  let next = 1;
  for (const { hunk, old, start } of placed) {
    for (let l = next - 1; l < start - 1; l += 1) out.push(file[l]);
    let at = start;
    for (const item of hunk.lines) {
      if (item.type === 'insert') out.push(item.line);
      else {
        if (item.type === 'equal') out.push(file[at - 1]);
        at += 1;
      }
    }
    next = start + old;
  }
  for (let l = next - 1; l < file.length; l += 1) out.push(file[l]);
  return { ok: true, text: joinLines(out), hunks: placed.map(({ start, offset, fuzz: used }) => ({ start, offset, fuzz: used })) };
}
