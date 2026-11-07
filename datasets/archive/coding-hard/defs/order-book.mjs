import { t, rng, randInt } from './_util.mjs';

const rand = rng(99);
function randomOrders(count) {
  const orders = [];
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const roll = rand();
    const id = 'o' + i;
    const side = rand() < 0.5 ? 'B' : 'S';
    if (roll < 0.12 && ids.length) {
      orders.push(['X', ids[randInt(rand, 0, ids.length - 1)]]);
    } else if (roll < 0.22) {
      orders.push(['M', id, side, randInt(rand, 1, 8)]);
      ids.push(id);
    } else {
      orders.push(['L', id, side, randInt(rand, 95, 105), randInt(rand, 1, 6)]);
      ids.push(id);
    }
  }
  return orders;
}

export default {
  name: 'matchOrders',
  signature: 'matchOrders(orders) -> object',
  kind: 'simulation',
  task: [
    'Simulate a limit order book. orders is an array that is processed in order; each element is one of: ["L", id, side, price, qty] (limit order), ["M", id, side, qty] (market order) or ["X", id] (cancel).',
    'id is a string, side is "B" (buy) or "S" (sell), price and qty are positive integers, and each id is used by at most one L or M order.',
    'Matching. An incoming buy order trades against resting sell orders, and an incoming sell order against resting buy orders. A limit buy only trades with resting sells whose price is at most its price; a limit sell only with resting buys whose price is at least its price; a market order accepts any price.',
    'The best resting order is matched first: the lowest price for an incoming buy, the highest price for an incoming sell; among equal prices the one that arrived earlier goes first.',
    "Each match is a trade of min(remaining incoming quantity, remaining resting quantity) units at the price of the resting order, never the incoming order's limit price. Keep matching until the incoming order is filled or no acceptable resting order is left.",
    'A limit order with quantity left then rests in the book and keeps its place by price and arrival; a market order with quantity left is dropped and never rests.',
    'Cancel removes the resting order with that id (with whatever quantity is left); if there is no such resting order (unknown id, an order that is already filled, or a market order) nothing happens.',
    'Return an object {trades, bids, asks}. trades lists every trade in order as [takerId, makerId, price, qty].',
    'bids and asks describe the book after all orders: one [price, totalRemainingQty] per price level, bids from the highest price to the lowest, asks from the lowest price to the highest; empty levels are not listed.',
  ].join(' '),
  edges: {
    'maker-price': "never the incoming order's limit price",
    'time-priority': 'the one that arrived earlier goes first',
    'price-priority': 'the lowest price for an incoming buy',
    'limit-bound': 'at most its price',
    'market-drop': 'never rests',
    'market-any-price': 'a market order accepts any price',
    'cancel-partial': 'whatever quantity is left',
    'cancel-noop': 'nothing happens',
    levels: 'one [price, totalRemainingQty] per price level',
  },
  tests: [
    t('basic', [[['L', 's1', 'S', 10, 5], ['L', 'b1', 'B', 10, 3]]], { trades: [['b1', 's1', 10, 3]], bids: [], asks: [[10, 2]] }),
    t('maker-price', [[['L', 's1', 'S', 9, 5], ['L', 'b1', 'B', 12, 5]]], { trades: [['b1', 's1', 9, 5]], bids: [], asks: [] }),
    t('time-priority', [[['L', 's1', 'S', 10, 2], ['L', 's2', 'S', 10, 2], ['L', 'b1', 'B', 10, 3]]], { trades: [['b1', 's1', 10, 2], ['b1', 's2', 10, 1]], bids: [], asks: [[10, 1]] }),
    t('price-priority', [[['L', 's1', 'S', 11, 2], ['L', 's2', 'S', 10, 2], ['L', 'b1', 'B', 11, 3]]], { trades: [['b1', 's2', 10, 2], ['b1', 's1', 11, 1]], bids: [], asks: [[11, 1]] }),
    t('basic', [[['L', 'b1', 'B', 9, 4], ['L', 's1', 'S', 10, 4]]], { trades: [], bids: [[9, 4]], asks: [[10, 4]] }),
    t('market-drop', [[['L', 's1', 'S', 10, 2], ['L', 's2', 'S', 12, 2], ['M', 'm1', 'B', 10]]], { trades: [['m1', 's1', 10, 2], ['m1', 's2', 12, 2]], bids: [], asks: [] }),
    t('market-drop', [[['M', 'm1', 'S', 5]]], { trades: [], bids: [], asks: [] }),
    t('cancel-partial', [[['L', 'b1', 'B', 10, 5], ['X', 'b1'], ['L', 's1', 'S', 10, 5]]], { trades: [], bids: [], asks: [[10, 5]] }),
    t('cancel-partial', [[['L', 's1', 'S', 10, 5], ['L', 'b1', 'B', 10, 2], ['X', 's1']]], { trades: [['b1', 's1', 10, 2]], bids: [], asks: [] }),
    t('cancel-noop', [[['L', 's1', 'S', 10, 1], ['L', 'b1', 'B', 10, 1], ['X', 's1'], ['X', 'zzz'], ['X', 'b1']]], { trades: [['b1', 's1', 10, 1]], bids: [], asks: [] }),
    t('price-priority', [[['L', 'b1', 'B', 10, 2], ['L', 'b2', 'B', 11, 2], ['L', 'b3', 'B', 11, 1], ['L', 's1', 'S', 10, 4]]], { trades: [['s1', 'b2', 11, 2], ['s1', 'b3', 11, 1], ['s1', 'b1', 10, 1]], bids: [[10, 1]], asks: [] }),
    t('levels', [[['L', 'b1', 'B', 10, 2], ['L', 'b2', 'B', 10, 3], ['L', 'b3', 'B', 9, 1], ['L', 's1', 'S', 15, 2], ['L', 's2', 'S', 15, 4], ['L', 's3', 'S', 14, 1]]], { trades: [], bids: [[10, 5], [9, 1]], asks: [[14, 1], [15, 6]] }),
    t('limit-bound', [[['L', 's1', 'S', 10, 1], ['L', 's2', 'S', 13, 1], ['L', 'b1', 'B', 12, 5]]], { trades: [['b1', 's1', 10, 1]], bids: [[12, 4]], asks: [[13, 1]] }),
    t('maker-price', [[['L', 'b1', 'B', 10, 5], ['L', 's1', 'S', 10, 3], ['L', 's2', 'S', 9, 4]]], { trades: [['s1', 'b1', 10, 3], ['s2', 'b1', 10, 2]], bids: [], asks: [[9, 2]] }),
    t('market-any-price', [[['L', 'b1', 'B', 10, 3], ['L', 'b2', 'B', 9, 3], ['M', 'm1', 'S', 4]]], { trades: [['m1', 'b1', 10, 3], ['m1', 'b2', 9, 1]], bids: [[9, 2]], asks: [] }),
    t('basic', [randomOrders(40)]),
    t('basic', [randomOrders(60)]),
  ],
};
