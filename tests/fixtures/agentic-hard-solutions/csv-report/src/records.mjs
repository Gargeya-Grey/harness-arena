// The first row of a file names the columns.

// Column names without a byte-order mark and without the spaces around them.
export function readHeader(row) {
  return row.map((name, index) => (index === 0 ? name.replace(/^﻿/, '') : name).trim());
}

// The index of the column called `wanted` (ignoring case and spaces), or -1.
export function findColumn(names, wanted) {
  const target = String(wanted).trim().toLowerCase();
  return names.findIndex((name) => name.toLowerCase() === target);
}

// Rows -> objects keyed by column name. A short row gets '' for the missing
// fields; fields beyond the header are dropped.
export function toRecords(rows) {
  if (rows.length === 0) return [];
  const names = readHeader(rows[0]);
  return rows.slice(1).map((row) => Object.fromEntries(names.map((name, index) => [name, row[index] ?? ''])));
}
