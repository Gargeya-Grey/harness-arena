import { t, rng, randInt, pick } from './_util.mjs';

const task = [
  'Write a matching engine for one instrument. runOrderBook(config, events) processes the events in order and returns { results, trades, book }. config is { tick, lot, band }: tick and lot are positive integers and band is an integer of 0 or more (a percentage). All prices and quantities are integers.',
  'Events are arrays: ["limit", id, account, side, price, qty, tif, display], ["market", id, account, side, qty], ["cancel", id] and ["replace", id, price, qty]. id and account are strings. side is "B" (buy) or "S" (sell). tif is "GTC", "IOC", "FOK" or "POST". display is a positive integer or null; a limit event may leave display out, which means null.',
  'Resting orders. An order that rests in the book has a price, a visible size and a hidden size. The orders at one price form a queue; a new resting order joins the end of the queue of its price. A resting order from a limit event whose display is smaller than its remaining quantity is an iceberg: its visible size is display and its hidden size is remaining minus display. Any other resting order has visible size = remaining quantity and hidden size 0. An order keeps its display value for as long as it is in the book.',
  'Matching. An incoming buy order trades with resting sell orders whose price is at most its limit price, lowest price first. An incoming sell order trades with resting buy orders whose price is at least its limit price, highest price first. A market order has no limit price and can trade at any price. Within one price, the order at the front of the queue goes first.',
  'Take the resting order r at the front of the best acceptable price. If r has the same account as the incoming order, r is removed from the book without a trade and matching goes on. Otherwise they trade q = the smaller of the incoming remaining quantity and the visible size of r, at the price of r. The trade is recorded as [buyId, sellId, price, q], and its price becomes the last trade price. When the visible size of r reaches 0 and r has a hidden size, r shows min(display, hidden size) from its hidden part and moves to the end of the queue of its price; without a hidden size, r is removed. Matching stops when the incoming remaining quantity is 0 or no acceptable resting order is left.',
  'Checks. A limit or market event is checked before it matches, in this order, and the first failure rejects it with the result "reject:<reason>" and no change to the book. "dup": id is the id of an order that rests in the book now (an id may be used again after its order has left the book). "lot": qty, or a display that is not null, is not a positive multiple of lot. "tick" (limit events only): price is not a positive multiple of tick. "band" (limit events only): a trade has happened and |price - last| * 100 > last * band, where last is the last trade price.',
  'Time in force of a limit event. "GTC": what is left after matching rests in the book. "IOC": what is left is dropped. "FOK": before matching, add the total size (visible plus hidden) of the resting orders on the other side that are acceptable for it and have a different account; if that sum is less than qty, the event is rejected with "reject:fok" and the book does not change; otherwise it matches as usual. "POST": if a resting order on the other side has a price that the incoming order could trade with, whatever its account, the event is rejected with "reject:post"; otherwise it rests without matching. A market event is dropped like IOC for what is left. A display on an IOC or FOK event is ignored after the check.',
  'Results. For a limit or market event that is not rejected, the result is "filled:N" when all of qty traded; otherwise "rested:N" when what is left was put in the book; otherwise "expired:N". N is the quantity that traded.',
  '"cancel" removes the resting order with that id and gives "cancelled:N", where N is its visible size plus its hidden size. An id that is not in the book gives "reject:unknown".',
  '"replace" gives the resting order id a new price and a new total quantity qty. Checks, in this order: "unknown" (the id is not in the book), "lot" (qty is not a positive multiple of lot), "tick" (price is not a positive multiple of tick) and "band" (as above, with the new price). A failed check changes nothing. If the new price equals the current price and qty is not more than the current total (visible plus hidden), the order keeps its place in the queue and loses the difference from its hidden size first, then from its visible size; the result is "replaced:0". Otherwise the order is removed and enters again as a GTC order with the same id, account, side and display, and the new price and quantity: it matches like an incoming limit order and what is left joins the end of the queue (there is no "dup" check). The result is "replaced:N", where N is the quantity that traded.',
  'Output. results holds one string per event. trades lists the trades in order. book is [bids, asks]; each list holds [id, price, visible plus hidden size] for every resting order, bids from the highest price and asks from the lowest price, and within one price in queue order.',
].join(' ');

const C = { tick: 5, lot: 10, band: 50 };
const L = (id, account, side, price, qty, tif = 'GTC', display) => (display === undefined ? ['limit', id, account, side, price, qty, tif] : ['limit', id, account, side, price, qty, tif, display]);

// Seeded scenarios that touch every rule: mixed accounts, icebergs, FOK, POST, STP, cancel, replace and bad input.
function scenario(seed, count, config) {
  const rand = rng(seed);
  const accounts = ['x', 'y', 'z'];
  const events = [];
  const resting = [];
  let n = 0;
  while (events.length < count) {
    const r = rand();
    const account = pick(rand, accounts);
    const side = rand() < 0.5 ? 'B' : 'S';
    const price = 100 + 5 * randInt(rand, -1, 1) + (rand() < 0.02 ? 2 : 0);
    const qty = 10 * randInt(rand, 1, 5) + (rand() < 0.02 ? 5 : 0);
    const target = () => (resting.length && rand() > 0.08 ? pick(rand, resting.slice(-8)) : 'nope');
    if (r < 0.74) {
      n += 1;
      const id = rand() < 0.03 && resting.length ? pick(rand, resting) : `o${n}`;
      const tifRoll = rand();
      const tif = tifRoll < 0.6 ? 'GTC' : tifRoll < 0.72 ? 'IOC' : tifRoll < 0.84 ? 'FOK' : 'POST';
      const display = rand() < 0.6 ? 10 * randInt(rand, 1, 2) : undefined;
      if (tif === 'GTC' || tif === 'POST') resting.push(id);
      events.push(L(id, account, side, price, qty, tif, display));
    } else if (r < 0.79) {
      n += 1;
      events.push(['market', `o${n}`, account, side, 10 * randInt(rand, 1, 5)]);
    } else if (r < 0.85) events.push(['cancel', target()]);
    else events.push(['replace', target(), price, qty]);
  }
  return [config, events];
}

export default {
  slug: 'order-book',
  tier: {
    level: 4,
    human_minutes: 100,
    basis: 'estimated from the reference (about 150 lines): a matching engine with queue priority, iceberg refresh, self-trade removal, four time-in-force modes, a fixed check order, cancel and a replace that keeps or loses its place; about 20 interacting rules, and an hour of an expert goes into reading them and checking each against a trace',
  },
  tags: ['spec', 'simulation'],
  name: 'runOrderBook',
  signature: 'runOrderBook(config, events) -> {results, trades, book}',
  task,
  edges: {
    'price-time': 'Within one price, the order at the front of the queue goes first',
    'self-trade': 'removed from the book without a trade',
    iceberg: 'moves to the end of the queue of its price',
    'check-order': 'the first failure rejects it',
    'lot-display': 'a display that is not null',
    band: 'the last trade price',
    fok: 'have a different account',
    post: 'whatever its account',
    market: 'can trade at any price',
    cancel: 'visible size plus its hidden size',
    'replace-keep': 'loses the difference from its hidden size first',
    'replace-requeue': 'enters again as a GTC order',
    'replace-checks': 'A failed check changes nothing',
    sell: 'highest price first',
  },
  tests: [
    // s3 at 95 is the best sell; at 100 the queue is s1 then s2. b1 buys 50: 10 from s3 at 95, 30 from s1 and 10 from s2 at 100.
    t('price-time', [C, [L('s1', 'x', 'S', 100, 30), L('s2', 'y', 'S', 100, 20), L('s3', 'y', 'S', 95, 10), L('b1', 'z', 'B', 100, 50)]], {
      results: ['rested:0', 'rested:0', 'rested:0', 'filled:50'],
      trades: [['b1', 's3', 95, 10], ['b1', 's1', 100, 30], ['b1', 's2', 100, 10]],
      book: [[], [['s2', 100, 10]]],
    }),
    // Checks run in the order dup, lot, tick, band. Order b is both a lot and a tick failure and shows "lot". Order a left the book, so its id is free again.
    // Band 10: after the trade at 100, price 115 gives 1500 > 1000 (reject), price 110 gives 1000, which is allowed.
    t('check-order', [{ tick: 5, lot: 10, band: 10 }, [
      L('a', 'x', 'B', 100, 10), L('a', 'x', 'B', 100, 10), L('b', 'x', 'B', 103, 15), L('b', 'x', 'B', 103, 20),
      L('s', 'y', 'S', 100, 10), L('c', 'x', 'B', 115, 10), L('c', 'x', 'B', 110, 10), L('d', 'x', 'B', 105, 10, 'GTC', 15), L('a', 'x', 'B', 105, 10),
    ]], {
      results: ['rested:0', 'reject:dup', 'reject:lot', 'reject:tick', 'filled:10', 'reject:band', 'rested:0', 'reject:lot', 'rested:0'],
      trades: [['a', 's', 100, 10]],
      book: [[['c', 110, 10], ['a', 105, 10]], []],
    }),
    // Market and IOC: the part that is not filled is dropped; an empty book gives expired:0.
    t('market', [{ tick: 5, lot: 10, band: 100 }, [L('s1', 'x', 'S', 100, 20), ['market', 'm1', 'y', 'B', 30], ['market', 'm2', 'y', 'B', 10], L('s2', 'x', 'S', 105, 10), L('i1', 'y', 'B', 100, 10, 'IOC'), L('i2', 'y', 'B', 105, 30, 'IOC')]], {
      results: ['rested:0', 'expired:20', 'expired:0', 'rested:0', 'expired:0', 'expired:10'],
      trades: [['m1', 's1', 100, 20], ['i2', 's2', 105, 10]],
      book: [[], []],
    }),
    // FOK: f1 needs 50 and 40 are there; f2 (account x) cannot count the 20 of its own s1, so 20 < 30; f3 counts only s2, 20 >= 20,
    // so it runs: s1 is removed without a trade and f3 trades 20 with s2 at 105.
    t('fok', [{ tick: 5, lot: 10, band: 100 }, [L('s1', 'x', 'S', 100, 20), L('s2', 'y', 'S', 105, 20), L('f1', 'z', 'B', 105, 50, 'FOK'), L('f2', 'x', 'B', 105, 30, 'FOK'), L('f3', 'x', 'B', 105, 20, 'FOK')]], {
      results: ['rested:0', 'rested:0', 'reject:fok', 'reject:fok', 'filled:20'],
      trades: [['f3', 's2', 105, 20]],
      book: [[], []],
    }),
    // POST is rejected when it could trade, also against its own account; p2 at 95 does not cross.
    t('post', [{ tick: 5, lot: 10, band: 100 }, [L('s1', 'x', 'S', 100, 10), L('p1', 'y', 'B', 100, 10, 'POST'), L('p2', 'y', 'B', 95, 10, 'POST'), L('p3', 'x', 'B', 100, 10, 'POST')]], {
      results: ['rested:0', 'reject:post', 'rested:0', 'reject:post'],
      trades: [],
      book: [[['p2', 95, 10]], [['s1', 100, 10]]],
    }),
    // b1 (account x) removes s1 (x) at 100, trades 10 with s2 (y) at 100, removes s3 (x) at 105, and rests with the 20 left.
    t('self-trade', [{ tick: 5, lot: 10, band: 100 }, [L('s1', 'x', 'S', 100, 10), L('s2', 'y', 'S', 100, 10), L('s3', 'x', 'S', 105, 10), L('b1', 'x', 'B', 105, 30)]], {
      results: ['rested:0', 'rested:0', 'rested:0', 'rested:10'],
      trades: [['b1', 's2', 100, 10]],
      book: [[['b1', 105, 20]], []],
    }),
    // s1 shows 20 and hides 30. b1 takes 20 from s1; s1 shows 20 again at the back (queue s2, s1), so b1 meets s2 next. b2 takes 20, then the last 10 of s1.
    t('iceberg', [{ tick: 5, lot: 10, band: 100 }, [L('s1', 'x', 'S', 100, 50, 'GTC', 20), L('s2', 'y', 'S', 100, 10), L('b1', 'z', 'B', 100, 30), L('b2', 'z', 'B', 100, 40)]], {
      results: ['rested:0', 'rested:0', 'filled:30', 'rested:30'],
      trades: [['b1', 's1', 100, 20], ['b1', 's2', 100, 10], ['b2', 's1', 100, 20], ['b2', 's1', 100, 10]],
      book: [[['b2', 100, 10]], []],
    }),
    // Replace: 20 < 30 keeps the place of s1; 40 > 20 grows it, so s1 goes behind s2 and b0 trades with s2. s3 moves from 100 to 95; b1 moves from 90 to 95,
    // trades 10 with s3 and rests with 10. s3 is gone (unknown); the cancel of b1 sees 10. The last three replaces fail their checks and change nothing.
    t('replace-requeue', [{ tick: 5, lot: 10, band: 100 }, [
      L('s1', 'x', 'S', 100, 30), L('s2', 'y', 'S', 100, 30), ['replace', 's1', 100, 20], ['replace', 's1', 100, 40], L('b0', 'z', 'B', 100, 30),
      L('s3', 'y', 'S', 100, 10), ['replace', 's3', 95, 10], L('b1', 'z', 'B', 90, 20), ['replace', 'b1', 95, 20], ['cancel', 's3'], ['cancel', 'b1'],
      ['replace', 'zz', 100, 10], ['replace', 's1', 101, 10], ['replace', 's1', 100, 15],
    ]], {
      results: ['rested:0', 'rested:0', 'replaced:0', 'replaced:0', 'filled:30', 'rested:0', 'replaced:0', 'rested:0', 'replaced:10', 'reject:unknown', 'cancelled:10', 'reject:unknown', 'reject:tick', 'reject:lot'],
      trades: [['b0', 's2', 100, 30], ['b1', 's3', 95, 10]],
      book: [[], [['s1', 100, 40]]],
    }),
    // s1 shows 20 and hides 40. Replace to 40 removes 20 from the hidden size (visible 20, hidden 20); replace to 10 removes 30: the hidden 20, then 10 of the visible
    // (visible 10, hidden 0). The reduction of s0 to 20 keeps its place in front of s1, so b1 (20) trades only with s0. The replace of s1 to 105 and 50 re-enters it
    // with its display 20 (visible 20, hidden 30); b2 takes 20, then the refreshed 10 of 20.
    t('replace-keep', [{ tick: 5, lot: 10, band: 100 }, [
      L('s0', 'y', 'S', 100, 30), L('s1', 'x', 'S', 100, 60, 'GTC', 20), ['replace', 's1', 100, 40], ['replace', 's1', 100, 10], ['replace', 's0', 100, 20],
      L('b1', 'z', 'B', 100, 20), ['replace', 's1', 105, 50], L('b2', 'z', 'B', 105, 30),
    ]], {
      results: ['rested:0', 'rested:0', 'replaced:0', 'replaced:0', 'replaced:0', 'filled:20', 'replaced:0', 'filled:30'],
      trades: [['b1', 's0', 100, 20], ['b2', 's1', 105, 20], ['b2', 's1', 105, 10]],
      book: [[], [['s1', 105, 20]]],
    }),
    // Band 10: no last price before the first trade; the price 1100 is allowed (10000 <= 10000), 1101 is not; a market event has no band;
    // after the trade at 1100, price 900 gives 20000 > 11000 (reject for replace), 990 gives exactly 11000 (allowed).
    t('band', [{ tick: 1, lot: 1, band: 10 }, [
      L('a', 'x', 'B', 1000, 5), L('b', 'y', 'S', 1000, 5), L('c', 'x', 'B', 1100, 5), L('d', 'x', 'B', 1101, 5), ['market', 'm', 'y', 'S', 5], L('e', 'x', 'S', 1000, 5), ['replace', 'e', 900, 5], L('f', 'x', 'S', 990, 5),
    ]], {
      results: ['rested:0', 'filled:5', 'rested:0', 'reject:band', 'filled:5', 'rested:0', 'reject:band', 'rested:0'],
      trades: [['a', 'b', 1000, 5], ['c', 'm', 1100, 5]],
      book: [[], [['f', 990, 5], ['e', 1000, 5]]],
    }),
    // A whole day of events: each of these hits icebergs, self-trades, FOK, POST, cancel, replace and bad input together.
    t('lot-display', scenario(7001, 44, { tick: 5, lot: 10, band: 30 })),
    t('basic', scenario(7002, 44, { tick: 5, lot: 10, band: 30 })),
    t('iceberg', scenario(7003, 46, { tick: 5, lot: 10, band: 25 })),
    t('fok', scenario(7004, 46, { tick: 5, lot: 10, band: 40 })),
    t('self-trade', scenario(7005, 48, { tick: 5, lot: 10, band: 20 })),
    t('replace-keep', scenario(7006, 48, { tick: 5, lot: 10, band: 30 })),
    t('sell', scenario(7007, 48, { tick: 5, lot: 10, band: 35 })),
    t('cancel', scenario(7008, 50, { tick: 5, lot: 10, band: 30 })),
    t('replace-checks', scenario(7009, 50, { tick: 5, lot: 10, band: 15 })),
  ],
};
