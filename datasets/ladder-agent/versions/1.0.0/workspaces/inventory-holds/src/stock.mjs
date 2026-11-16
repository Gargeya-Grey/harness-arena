// What is on the shelf, and the ledger of every movement.
export function createStock() {
  const onHand = new Map();
  const ledger = [];
  return {
    has: (sku) => onHand.has(sku),
    onHand: (sku) => onHand.get(sku) ?? 0,
    move(sku, delta, type, at) {
      onHand.set(sku, (onHand.get(sku) ?? 0) + delta);
      ledger.push({ type, sku, qty: delta, at });
    },
    ledger: () => ledger.map((entry) => ({ ...entry })),
  };
}
