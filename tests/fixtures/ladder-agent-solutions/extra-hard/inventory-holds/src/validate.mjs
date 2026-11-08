export function requireWhole(value, name, min = 1) {
  if (!Number.isInteger(value) || value < min) throw new RangeError(`${name} must be a whole number of at least ${min}`);
  return value;
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Lines of a hold -> one line per sku, quantities added up, sorted by sku.
export function normalizeLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new RangeError('a hold needs at least one line');
  const merged = new Map();
  for (const line of lines) {
    if (typeof line?.sku !== 'string' || line.sku === '') throw new TypeError('sku must be text');
    requireWhole(line.qty, 'qty');
    merged.set(line.sku, (merged.get(line.sku) ?? 0) + line.qty);
  }
  return [...merged].map(([sku, qty]) => ({ sku, qty })).sort((a, b) => byText(a.sku, b.sku));
}
