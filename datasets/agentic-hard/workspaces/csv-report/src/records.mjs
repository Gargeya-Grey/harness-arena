// The first row of a file names the columns.
export function readHeader(row) {
  return row;
}

// The index of the column called `wanted`, or -1.
export function findColumn(names, wanted) {
  return names.indexOf(wanted);
}

// Rows -> objects keyed by column name. A short row gets '' for the missing
// fields; fields beyond the header are dropped.
export function toRecords(rows) {
  if (rows.length === 0) return [];
  const names = readHeader(rows[0]);
  return rows.slice(1).map((row) => Object.fromEntries(names.map((name, index) => [name, row[index] ?? ''])));
}
