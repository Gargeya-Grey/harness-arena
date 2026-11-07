// A plain-text table of a summary: one line per group, then the total.
export function renderTable(summary, { decimals = 2 } = {}) {
  const num = (value) => (value === null ? '-' : value.toFixed(decimals));
  const lines = [['group', 'count', 'sum', 'avg'], ...summary.groups.map((g) => [g.key, String(g.count), num(g.sum), num(g.avg)]), ['TOTAL', String(summary.total.count), num(summary.total.sum), num(summary.total.avg)]];
  const widths = lines[0].map((_, column) => Math.max(...lines.map((line) => line[column].length)));
  return lines.map((line) => line.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ').trimEnd()).join('\n');
}
