// What can still be promised for a sku: on hand, minus active holds, minus the safety stock kept back. Never below 0.
export function availableFor({ stock, holds, safety }, sku, now) {
  const onHand = stock.onHand(sku);
  const held = holds.heldFor(sku, now);
  return { onHand, held, available: Math.max(0, onHand - held - (safety[sku] ?? 0)) };
}
