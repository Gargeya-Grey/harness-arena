// Shared helpers for the new (tier 4 and 5) families of ladder-answer: a seeded
// random stream per family and instance number, and text helpers. A family draws
// numbers only from its own stream, so adding a family never changes another.

export const SEED = 20261108;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(name, n) {
  const next = mulberry32(hash(`${SEED}:${name}:${n}`));
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (items) => items[int(0, items.length - 1)];
  const shuffle = (items) => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const sample = (items, k) => shuffle(items).slice(0, k);
  // Draws until `build` returns a value (not null); fails loudly, never loops forever.
  const attempt = (build, limit = 5000) => {
    for (let i = 0; i < limit; i += 1) {
      const value = build();
      if (value != null) return value;
    }
    throw new Error(`family ${name} #${n}: no acceptable instance in ${limit} draws`);
  };
  return { next, int, pick, shuffle, sample, attempt };
}

export const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
export const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
export const orList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);

export const NAMES = ['Aldo', 'Brisa', 'Cato', 'Dalia', 'Emeka', 'Farid', 'Greta', 'Hana', 'Ivo', 'Jorun', 'Kemal', 'Lior', 'Mina', 'Nuno', 'Odette', 'Pavel', 'Quill', 'Rafa', 'Sana', 'Tove', 'Ugo', 'Vera', 'Wim', 'Xenia', 'Yusuf', 'Zora'];
export const TOWNS = ['Ashby', 'Brill', 'Cawdor', 'Dunmore', 'Elwick', 'Fenham', 'Garth', 'Hollin', 'Ingram', 'Jarrow', 'Kelby', 'Lorne', 'Marlow', 'Netley', 'Orsett', 'Penrith', 'Quenby', 'Ryhall', 'Selby', 'Tarn'];

// ---- dates (UTC, ISO text) ---------------------------------------------------

export const DAY = 86400000;
export const toTime = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const toIso = (time) => new Date(time).toISOString().slice(0, 10);
export const weekdayOf = (time) => new Date(time).getUTCDay();
export const dateText = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
