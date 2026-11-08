// Cell references. Done; SPEC.md section 1.
export const MAX_COL = 702; // ZZ
export const MAX_ROW = 1000;

const REF = /^(\$?)([A-Za-z]{1,2})(\$?)([0-9]+)$/;

export function colToNumber(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numberToCol(n) {
  return n > 26 ? String.fromCharCode(64 + Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)) : String.fromCharCode(64 + n);
}

/**
 * { col, row } (numbers, possibly outside the grid) for text of the form
 * [$]letters[$]digits with one or two letters, else null. Dollar marks are
 * accepted only with allowDollar.
 */
export function splitRef(text, allowDollar = false) {
  const match = typeof text === 'string' ? REF.exec(text) : null;
  if (!match) return null;
  if (!allowDollar && (match[1] || match[3])) return null;
  return { col: colToNumber(match[2]), row: Number(match[4]) };
}

export const inGrid = ({ col, row }) => col >= 1 && col <= MAX_COL && row >= 1 && row <= MAX_ROW;
export const formatRef = ({ col, row }) => `${numberToCol(col)}${row}`;

/** A number that sorts cells in reading order (row first, then column). */
export const orderKey = ({ col, row }) => row * 1024 + col;
export const fromOrderKey = (key) => ({ row: Math.floor(key / 1024), col: key % 1024 });
