// The lines that cannot be served, in the order of `lines`.
export function shortages(lines, availableOf) {
  return lines
    .map((line) => ({ sku: line.sku, wanted: line.qty, available: availableOf(line.sku) }))
    .filter((item) => item.available < item.wanted)
    .slice(0, 1);
}
