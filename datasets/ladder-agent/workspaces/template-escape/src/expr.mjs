// An expression is one value or a helper call.
//   user.name            -> { kind: 'path', path: 'user.name' }
//   "text" or 12         -> { kind: 'literal', value }
//   upper user.name "x"  -> { kind: 'call', helper: 'upper', args: [...] }
function toArg(text) {
  if (text.startsWith('"')) return { kind: 'literal', value: JSON.parse(text) };
  if (/^-?\d+(\.\d+)?$/.test(text)) return { kind: 'literal', value: Number(text) };
  return { kind: 'path', path: text };
}

export function parseExpr(text) {
  const parts = text.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
  if (parts.length === 0) throw new Error('empty expression');
  if (parts.length === 1) return toArg(parts[0]);
  return { kind: 'call', helper: parts[0], args: parts.slice(1).map(toArg) };
}
