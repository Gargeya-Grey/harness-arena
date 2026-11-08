import { t, rng, randInt } from './_util.mjs';

const rand = rng(8128);
function randomGraph(n, edgeCount, maxWeight) {
  return Array.from({ length: edgeCount }, () => [randInt(rand, 0, n - 1), randInt(rand, 0, n - 1), randInt(rand, 0, maxWeight)]);
}
const chain = Array.from({ length: 299 }, (_, i) => [i, i + 1, 1000000000]);

export default {
  slug: 'coupon-path',
  tier: { level: 3, human_minutes: 18, basis: 'estimated from the reference (56 lines): Dijkstra over (node, coupons used) layers', origin: 'coding-hard-coupon-path' },
  name: 'cheapestWithCoupons',
  signature: 'cheapestWithCoupons(n, edges, k, from, to) -> number',
  tags: ['graph'],
  task: [
    'Find the cheapest way to travel in a directed graph when you have coupons.',
    'The graph has n nodes numbered 0 to n-1 (1 <= n <= 300). edges is an array of [u, v, w]: a directed edge from u to v that costs w, an integer from 0 to 1000000000 (w can be 0). There can be several edges between the same two nodes, and edges from a node to itself.',
    'You may use up to k coupons (k is an integer from 0 to 30). A coupon is used on one crossing of one edge and changes the cost of that crossing from w to floor(w / 2); one crossing can use at most one coupon, and an edge that is crossed twice needs a coupon each time. Using fewer than k coupons is allowed.',
    'Return the minimum total cost to go from node from to node to, or -1 if to cannot be reached from from. If from equals to the cost is 0.',
    'Note that the cheapest way without coupons is not always the cheapest way with them.',
  ].join(' '),
  edges: {
    floor: 'floor(w / 2)',
    parallel: 'several edges between the same two nodes',
    'zero-weight': 'w can be 0',
    unreachable: 'cannot be reached',
    'same-node': 'If from equals to the cost is 0',
    'fewer-coupons': 'Using fewer than k coupons is allowed',
    'route-changes': 'not always the cheapest way with them',
    'large-weights': '1000000000',
  },
  tests: [
    t('basic', [3, [[0, 1, 10], [1, 2, 10]], 1, 0, 2], 15),
    t('route-changes', [4, [[0, 1, 10], [1, 3, 10], [0, 3, 21]], 1, 0, 3], 10),
    t('basic', [4, [[0, 1, 10], [1, 3, 10], [0, 3, 21]], 0, 0, 3], 20),
    t('unreachable', [3, [[0, 1, 1]], 5, 0, 2], -1),
    t('unreachable', [2, [[1, 0, 1]], 3, 0, 1], -1),
    t('same-node', [2, [], 0, 1, 1], 0),
    t('floor', [2, [[0, 1, 5]], 1, 0, 1], 2),
    t('fewer-coupons', [3, [[0, 1, 4], [1, 2, 6]], 10, 0, 2], 5),
    t('parallel', [2, [[0, 1, 10], [0, 1, 3], [0, 1, 8]], 1, 0, 1], 1),
    t('zero-weight', [3, [[0, 1, 0], [1, 2, 7]], 1, 0, 2], 3),
    t('basic', [3, [[0, 0, 1], [1, 0, 1], [0, 2, 9], [2, 1, 1]], 1, 0, 1], 5),
    t('basic', [5, [[0, 1, 2], [1, 4, 2], [0, 2, 3], [2, 3, 30], [3, 4, 1]], 1, 0, 4], 3),
    t('route-changes', [4, [[0, 1, 100], [1, 3, 100], [0, 2, 150], [2, 3, 61]], 1, 0, 3], 136),
    t('route-changes', [4, [[0, 1, 100], [1, 3, 100], [0, 2, 150], [2, 3, 61]], 2, 0, 3], 100),
    t('large-weights', [300, chain, 30, 0, 299], 284000000000),
    t('basic', [40, randomGraph(40, 150, 50), 5, 0, 39]),
    t('basic', [40, randomGraph(40, 90, 1000), 3, 3, 30]),
    t('unreachable', [120, randomGraph(120, 150, 100), 30, 0, 119]),
  ],
};
