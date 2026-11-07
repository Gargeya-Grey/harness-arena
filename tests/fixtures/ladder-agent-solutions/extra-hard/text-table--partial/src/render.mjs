import { pad } from './align.mjs';
import { STYLES, rowLine, rule } from './border.mjs';
import { columnWidths } from './layout.mjs';
import { cellLines } from './normalize.mjs';
import { formatNumber } from './numbers.mjs';
import { displayWidth } from './tokens.mjs';
import { truncate } from './truncate.mjs';
import { wrapLine } from './wrap.mjs';

// renderTable({ columns, rows, border: 'ascii' | 'unicode' | 'none', padding: 1, maxWidth, ellipsis: '…', header: true })
//   column: { key, title, type: 'text' | 'number', align, decimals, thousands, width, minWidth, maxWidth, overflow: 'truncate' | 'wrap' }
// A number column is right-aligned unless it says otherwise. Returns the lines joined with '\n'.
export function renderTable({ columns, rows, border = 'ascii', padding = 1, maxWidth, ellipsis = '…', header = true }) {
  if (!Array.isArray(columns) || columns.length === 0) throw new RangeError('a table needs at least one column');
  if (border !== 'none' && !STYLES[border]) throw new RangeError(`unknown border ${border}`);
  if (!Number.isInteger(padding) || padding < 0) throw new RangeError('padding is a whole number of at least 0');

  const text = (column, value) => (column.type === 'number' && typeof value === 'number' ? formatNumber(value, column) : value);
  const body = rows.map((row) => columns.map((column) => cellLines(text(column, row[column.key]))));
  const head = columns.map((column) => cellLines(column.title ?? column.key));
  const naturals = columns.map((_, index) => Math.max(...[head[index], ...body.map((cells) => cells[index])].flat().map(displayWidth)));
  const framing = border === 'none' ? 0 : columns.length + 1;
  const widths = columnWidths(columns, naturals, { tableMax: maxWidth, extra: framing + 2 * padding * columns.length });

  const fit = (column, width, lines) =>
    lines.flatMap((line) => (column.overflow === 'wrap' ? wrapLine(line, width) : [truncate(line, width, ellipsis)]));
  const cellText = (column, width, lines, height) => {
    const align = column.align ?? (column.type === 'number' ? 'right' : 'left');
    const shown = fit(column, width, lines);
    while (shown.length < height) shown.push('');
    return shown.map((line) => ' '.repeat(padding) + pad(line, width, align) + ' '.repeat(padding));
  };
  const rowLines = (cells) => {
    const fitted = cells.map((lines, index) => fit(columns[index], widths[index], lines));
    const height = Math.max(...fitted.map((lines) => lines.length));
    const grids = cells.map((lines, index) => cellText(columns[index], widths[index], lines, height));
    return Array.from({ length: height }, (_, line) => grids.map((grid) => grid[line]));
  };

  const style = STYLES[border];
  const cellWidths = widths.map((width) => width + 2 * padding);
  const out = [];
  const emit = (cells) => out.push(style ? rowLine(style, cells) : cells.join('').replace(/\s+$/, ''));
  if (style) out.push(rule(style, 'top', cellWidths));
  if (header) {
    rowLines(head).forEach(emit);
    if (style) out.push(rule(style, 'mid', cellWidths));
  }
  for (const cells of body) rowLines(cells).forEach(emit);
  if (style) out.push(rule(style, 'bottom', cellWidths));
  return out.join('\n');
}
