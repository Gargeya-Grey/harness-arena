// Column widths, in display columns, without padding or borders.
// A column with `width` keeps it. Any other starts at its widest line, held to maxWidth.
// When `maxWidth` of the table is set and the table is wider, the widest column loses one column at a time.
export function columnWidths(columns, naturals, { tableMax, extra }) {
  const widths = columns.map((column, index) => {
    if (column.width !== undefined) return column.width;
    return Math.min(column.maxWidth ?? Infinity, naturals[index]);
  });
  if (tableMax === undefined) return widths;
  const total = () => widths.reduce((sum, width) => sum + width, 0) + extra;
  while (total() > tableMax) {
    let pick = -1;
    columns.forEach((column, index) => {
      if (widths[index] <= (column.minWidth ?? 1)) return;
      if (pick === -1 || widths[index] > widths[pick]) pick = index;
    });
    if (pick === -1) throw new RangeError(`the table cannot fit in ${tableMax} columns`);
    widths[pick] -= 1;
  }
  return widths;
}
