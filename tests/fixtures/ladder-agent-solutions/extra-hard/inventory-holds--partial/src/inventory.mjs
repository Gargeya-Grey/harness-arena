import { availableFor } from './availability.mjs';
import { systemClock } from './clock.mjs';
import { ConflictError, UnknownSkuError } from './errors.mjs';
import { extendedExpiry, firstExpiry } from './expiry.mjs';
import { createHolds } from './holds.mjs';
import { sameLines } from './replay.mjs';
import { shortages } from './report.mjs';
import { createStock } from './stock.mjs';
import { normalizeLines, requireWhole } from './validate.mjs';

// createInventory({ clock, holdTtlMs, maxHoldMs, safety: { sku: units kept back } })
//   receive(sku, qty)  adjust(sku, delta, reason)  snapshot(sku) -> { onHand, held, available }
//   hold(id, lines, { ttlMs }) -> { ok: true, replay, hold } | { ok: false, short: [{ sku, wanted, available }] }
//   extend(id, ms)  release(id)  commit(id)  expiring(withinMs)  ledger()
export function createInventory({ clock = systemClock, holdTtlMs = 900_000, maxHoldMs = 3_600_000, safety = {} } = {}) {
  const stock = createStock();
  const holds = createHolds();
  const availability = (sku, now) => availableFor({ stock, holds, safety }, sku, now);
  const view = (hold) => ({ id: hold.id, state: hold.state, lines: hold.lines.map((line) => ({ ...line })), createdAt: hold.createdAt, expiresAt: hold.expiresAt });
  const knownSku = (sku) => {
    if (!stock.has(sku)) throw new UnknownSkuError(`unknown sku ${sku}`);
  };
  // The active hold with this id, after the expired ones are marked.
  const activeHold = (id, now) => {
    holds.sweep(now);
    const hold = holds.get(id);
    return hold && hold.state === 'active' ? hold : null;
  };

  return {
    receive(sku, qty) {
      requireWhole(qty, 'qty');
      stock.move(sku, qty, 'receive', clock.now());
    },
    adjust(sku, delta, reason) {
      const now = clock.now();
      knownSku(sku);
      if (!Number.isInteger(delta) || delta === 0) throw new RangeError('delta must be a whole number, not 0');
      if (stock.onHand(sku) + delta < holds.heldFor(sku, now)) throw new ConflictError(`active holds need more of ${sku}`);
      stock.move(sku, delta, 'adjust', now);
    },
    snapshot(sku) {
      knownSku(sku);
      return availability(sku, clock.now());
    },
    hold(id, lines, options = {}) {
      const now = clock.now();
      holds.sweep(now);
      const wanted = normalizeLines(lines);
      const ttlMs = options.ttlMs === undefined ? holdTtlMs : requireWhole(options.ttlMs, 'ttlMs');
      const existing = holds.get(id);
      if (existing?.state === 'committed') throw new ConflictError(`hold id ${id} is used by a committed hold`);
      if (existing?.state === 'active') {
        if (!sameLines(existing.lines, wanted)) throw new ConflictError(`hold id ${id} is active with other lines`);
        return { ok: true, replay: true, hold: view(existing) };
      }
      for (const line of wanted) knownSku(line.sku);
      const short = shortages(wanted, (sku) => availability(sku, now).available);
      if (short.length) return { ok: false, short };
      const hold = { id, lines: wanted, state: 'active', createdAt: now, expiresAt: firstExpiry(now, ttlMs, maxHoldMs) };
      holds.put(hold);
      return { ok: true, replay: false, hold: view(hold) };
    },
    extend(id, ms) {
      requireWhole(ms, 'ms');
      const hold = activeHold(id, clock.now());
      if (!hold) return false;
      hold.expiresAt = extendedExpiry(hold, ms, maxHoldMs);
      return true;
    },
    release(id) {
      const hold = activeHold(id, clock.now());
      if (!hold) return false;
      hold.state = 'released';
      return true;
    },
    commit(id) {
      const now = clock.now();
      const hold = activeHold(id, now);
      if (!hold) return false;
      for (const line of hold.lines) stock.move(line.sku, -line.qty, 'commit', now);
      hold.state = 'committed';
      return true;
    },
    expiring: (withinMs) => holds.expiring(clock.now(), withinMs),
    ledger: () => stock.ledger(),
  };
}
