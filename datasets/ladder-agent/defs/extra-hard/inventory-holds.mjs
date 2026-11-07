export default {
  slug: 'inventory-holds',
  tier: {
    level: 4,
    human_minutes: 45,
    basis: 'Estimate from the size of the work, not a timed solve: about 14 separate faults in 7 of 12 files, roughly 20 minutes to find them by reading and running the code and 25 to fix and check them.',
  },
  tags: ['bugfix'],
  task: `Our stock holds (reservations) are wrong in several ways.
- After a hold's time is up, its stock stays reserved until someone makes another hold: the stock numbers still show it as held, and adjust() refuses a correction that the shelf can take.
- A hold is still alive at the exact moment it should expire.
- commit(), extend() and release() work on a hold whose time is up, and commit() then takes stock that may be promised to someone else.
- A hold can be extended again and again with no end, and a long ttlMs gives a hold a longer life than the shop allows.
- Two lines of one request for the same sku are each checked alone, so a hold can take more than is on the shelf and the available number goes negative.
- The reply for a request that cannot be served names only the first short line.
- Sending a hold again with the same id but another quantity is taken for a replay, and an id can never be used again after its hold was released or expired.
- The available number goes below 0 when the safety stock is more than what is on the shelf.
- expiring() puts the holds in the order of their ids.

The rules we agreed on:
- A hold is active from the moment it is made up to, but not including, its expiresAt. Expired holds count nowhere: not in snapshot(), not in the check of a new hold, not in adjust(), not in expiring(), and commit(), extend() and release() answer false for them.
- The first expiresAt is now + min(ttlMs, maxHoldMs); ttlMs is whole milliseconds of at least 1 (RangeError otherwise). extend(id, ms) adds ms to the current expiresAt, but a hold never lives longer than maxHoldMs counted from its creation; when the extension is cut short it still answers true. ms must be a whole number of at least 1 (RangeError otherwise).
- The lines of a request are merged first: one line per sku, quantities added up, sorted by sku. A hold takes all its lines or nothing. When it cannot be served the reply is { ok: false, short } and short holds an item { sku, wanted, available } for every sku that is short, sorted by sku, where wanted is the merged quantity.
- available is onHand - held - safety[sku], and never below 0.
- A hold id that is active with the same merged lines is a replay: the reply is { ok: true, replay: true } with the existing hold, and nothing is reserved twice or renewed. The same id active with other lines or other quantities throws ConflictError. An id of a committed hold throws ConflictError for good. An id of a released or an expired hold is free and starts a new hold.
- adjust() takes a whole, non-zero delta; a delta that would leave less on the shelf than the active holds need throws ConflictError, and an unknown sku throws UnknownSkuError.
- expiring(withinMs) lists { id, expiresAt } of the active holds that end within withinMs from now (an end exactly withinMs away counts), soonest first, ties by id.

Public exports stay as they are. The existing tests must keep passing and must not be edited; put any new tests in new files.`,
};
