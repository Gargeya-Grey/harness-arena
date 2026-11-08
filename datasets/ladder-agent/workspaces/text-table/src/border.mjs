export const STYLES = {
  ascii: { h: '-', v: '|', top: ['+', '+', '+'], mid: ['+', '+', '+'], bottom: ['+', '+', '+'] },
  unicode: { h: '─', v: '│', top: ['┌', '┬', '┐'], mid: ['├', '┼', '┤'], bottom: ['└', '┴', '┘'] },
};

// A horizontal rule over cells of the given widths (padding included): edge, cross, edge.
export function rule(style, kind, cellWidths) {
  const [left, cross, right] = style[kind];
  return left + cellWidths.map((width) => style.h.repeat(width)).join(cross) + right;
}

export const rowLine = (style, cells) => style.v + cells.join(style.v) + style.v;
