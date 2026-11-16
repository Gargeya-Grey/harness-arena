import { t } from './_util.mjs';

export default {
  slug: 'bipartite-timeline',
  tier: {
    level: 4,
    human_minutes: 90,
    basis: 'The reference is about 130 lines: edge lifetimes, a segment tree over the queries, and a union-find with parity and rollback that tracks the component count and the odd cycles; it is the offline dynamic-connectivity method with a twist, and an expert needs an hour and a half to build it and to get the lifetimes and the rollback right.',
  },
  tags: ['efficiency', 'graph'],
  name: 'bipartiteTimeline',
  signature: 'bipartiteTimeline(n, events, seed) -> number',
  task: [
    'Events change an undirected graph on the nodes 1..n.',
    'An "add" event adds an edge and gives it the next number: 1 for the first add event, 2 for the second, and so on. An edge between u and u (a loop) is allowed, and two edges between the same pair of nodes are two different edges (parallel edges). A "del" event removes the edge with that number if it is in the graph now; nothing happens when it was removed before or when no edge has that number yet. A removed edge is never added again.',
    'A "query" event records two facts about the graph as it is at that moment: components, the number of connected components, counting every node (an isolated node is a component); and flag, which is 1 when the graph is bipartite and 0 when it is not. A graph is bipartite when its nodes can be coloured with two colours so that every edge joins two different colours, so a loop makes it not bipartite, and so does any cycle of odd length.',
    'Return the sum over the queries of q * (2 * components + flag), where q is 1 for the first query, 2 for the second, and so on. When there is no query, return 0.',
    'events is either an array of explicit events, each of them ["add", u, v], ["del", k] or ["query"] (then seed is ignored), or an integer m, and then m events are generated from seed.',
    'The generator starts with x_0 = seed and updates x_(i+1) = (x_i * 48271 + 11) mod 2147483647 (exact integer arithmetic; every product is below 2^47). Each draw returns the new x after the update, so the first draw returns x_1 and never x_0. For each event it draws three consecutive terms a, b, c, in this order, and kind = a mod 8. For kind 0, 1 or 2 it is an add event with u = (b mod n) + 1 and v = (c mod n) + 1, except that when floor(a / 8) mod 1500 is not 0 and u and v are both odd or both even, v is replaced by (v mod n) + 1 (n is even in this form, so the edge then joins an odd and an even node). For kind 3 it is a del event with k = (b mod A) + 1, where A is the number of add events so far; when A is 0 the event is skipped. For kinds 4 to 7 it is a query event.',
    'Example n=2, m=2, seed=1: the six draws are 48282, 183136786, 1153105965, 949389933, 700428874, 419638497. The first event has kind 2 and adds edge 1-2. The second has kind 5 and queries one bipartite component, contributing 1*(2*1+1)=3; return 3.',
    'Limits: explicit form 1 <= n <= 1000 and at most 1000 events; generated form n even with 2 <= n <= 40000, 1 <= m <= 60000 and 1 <= seed <= 2147483646.',
    'The inputs are too large for any method that rebuilds the graph for every query.',
  ].join(' '),
  edges: {
    'odd-cycle': 'so does any cycle of odd length',
    loop: 'a loop makes it not bipartite',
    'removal-noop': 'nothing happens when it was removed before',
    isolated: 'an isolated node is a component',
    generated: 'then m events are generated from seed',
    huge: '60000',
  },
  tests: [
    // q1: edges 1-2, 2-3: components {1,2,3} and {4} = 2, bipartite: 2*2+1 = 5, times 1 = 5. q2: the edge 3 (1-3) closes a triangle: 2*2+0 = 4, times 2 = 8.
    // q3: edge 3 removed: 5 times 3 = 15. q4: edge 4 is the loop 4-4: 4 times 4 = 16. q5: edges 4 and 1 removed, edge 2 (2-3) is left: components {2,3}, {1}, {4} = 3, bipartite: 7 times 5 = 35. Total 79.
    t('odd-cycle', [4, [['add', 1, 2], ['add', 2, 3], ['query'], ['add', 1, 3], ['query'], ['del', 3], ['query'], ['add', 4, 4], ['query'], ['del', 4], ['del', 1], ['query']], 0], 79),
    // n = 1: q1 no edge: 2*1+1 = 3, times 1. q2 with the loop: 2*1+0 = 2, times 2 = 4. q3 after the removal: 3 times 3 = 9. Total 16.
    t('loop', [1, [['query'], ['add', 1, 1], ['query'], ['del', 1], ['query']], 0], 16),
    // Two parallel edges 1-2: q1 5 (components {1,2}, {3}, bipartite), q2 after removing edge 1: 5 times 2 = 10; the second del 1 and del 9 do nothing: 5 times 3 = 15;
    // q4 after removing edge 2: three components, 2*3+1 = 7, times 4 = 28. Total 5 + 10 + 15 + 28 = 58.
    t('removal-noop', [3, [['add', 1, 2], ['add', 1, 2], ['query'], ['del', 1], ['query'], ['del', 1], ['del', 9], ['query'], ['del', 2], ['query']], 0], 58),
    // A square 1-2-3-4 and the isolated node 5: q1 2 components, bipartite: 5. Edge 5 is the chord 1-3, a triangle: 4 times 2 = 8. Chord removed: 5 times 3 = 15.
    // Edge 6 is the loop 5-5, edge 1 (1-2) is removed: the path 2-3-4-1 is one component and node 5 another, with a loop: 4 times 4 = 16. Loop removed: 5 times 5 = 25. Total 69.
    t('isolated', [5, [['add', 1, 2], ['add', 2, 3], ['add', 3, 4], ['add', 4, 1], ['query'], ['add', 1, 3], ['query'], ['del', 5], ['query'], ['add', 5, 5], ['del', 1], ['query'], ['del', 6], ['query']], 0], 69),
    t('generated', [2, 2, 1], 3),
    t('huge', [16000, 60000, 7]),
    t('huge', [10000, 60000, 3]),
    t('huge', [16000, 60000, 101]),
    t('huge', [12000, 60000, 2026]),
    t('huge', [16000, 60000, 555]),
    t('huge', [14000, 60000, 8675309]),
    t('huge', [15000, 60000, 13]),
    t('huge', [10000, 60000, 77]),
    t('huge', [16000, 60000, 31337]),
    t('huge', [8000, 60000, 9]),
  ],
};
