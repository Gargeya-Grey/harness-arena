import { isActive } from './expiry.mjs';

// The holds by id. States: active, released, expired, committed.
export function createHolds() {
  const byId = new Map();
  return {
    get: (id) => byId.get(id),
    put: (hold) => byId.set(hold.id, hold),
    // Units of a sku that active holds keep back at `now`.
    heldFor(sku, now) {
      let total = 0;
      for (const hold of byId.values()) {
        if (hold.state !== 'active') continue;
        for (const line of hold.lines) if (line.sku === sku) total += line.qty;
      }
      return total;
    },
    // Marks the holds whose time is up.
    sweep(now) {
      for (const hold of byId.values()) if (hold.state === 'active' && !isActive(hold, now)) hold.state = 'expired';
    },
    // Active holds that end within `within` ms, soonest first, ties by id.
    expiring(now, within) {
      return [...byId.values()]
        .filter((hold) => isActive(hold, now) && hold.expiresAt - now <= within)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((hold) => ({ id: hold.id, expiresAt: hold.expiresAt }));
    },
  };
}
