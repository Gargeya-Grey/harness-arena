import { t } from './_util.mjs';

export default {
  slug: 'depot-tree-costs',
  tier: {
    level: 5,
    human_minutes: 240,
    basis: 'Two techniques together: centroid decomposition (iterative, because the tree can be 50000 levels deep) and a convex hull of lines per centroid, with walk costs that differ by direction, so each vertex needs both a "to the centroid" and a "from the centroid" distance. The best simple answer walks the tree from every depot, O(n^2), 25 s or more of CPU on the largest inputs. About 4 h for an expert who has both ideas ready.',
  },
  tags: ['efficiency'],
  name: 'depotCostChecksum',
  signature: 'depotCostChecksum(n, window, maxCost, maxSetup, maxRate, seed) -> number',
  task: [
    'A rooted tree with n vertices numbered 0..n-1 (vertex 0 is the root) has a depot on every vertex. The tree, its edge costs and the depots are all built from a pseudo-random generator, so the input stays small.',
    'The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 for i = 0, 1, 2, ... (exact integer arithmetic; every product is below 2^47). Each draw returns the new x.',
    'Step 1: for i = 1..n-1, draw r and set parent(i) = i - 1 - (r mod min(i, window)). So parent(i) < i. With window = 1 the tree is a single path 0-1-2-...-(n-1); a larger window gives a bushier tree.',
    'Step 2: for i = 1..n-1, draw r1 and then r2, and set down(i) = 1 + (r1 mod maxCost) and up(i) = r2 mod (maxCost + 1). down(i) is the cost of walking along the edge from parent(i) to i. up(i) is the cost of walking along the same edge from i to parent(i). The two directions of an edge can cost differently, and an upward cost of 0 is allowed.',
    'Step 3: for v = 0..n-1, draw r1 and then r2, and set setup(v) = r1 mod (maxSetup + 1) and rate(v) = r2 mod (maxRate + 1). A rate of 0 is allowed.',
    'The walk cost walk(u, v) is the sum of the edge costs along the unique path from u to v, where every edge is paid in the direction of the walk: up(i) when the walk goes from i to parent(i), down(i) when it goes from parent(i) to i. walk(u, u) = 0.',
    'The depot on u can serve vertex v at the price setup(u) + rate(u) * walk(u, v). A vertex may be served by its own depot. The service cost f(v) is the smallest price over all depots u.',
    'Fold f(0), f(1), ..., f(n-1) into a checksum: h starts at 0, and for each v in this order h = (h * 1000003 + f(v)) mod 1000000007. Return h as a number. Every f(v) and every intermediate product is an exact integer below 2^53.',
    'Limits: 1 <= n <= 50000; 1 <= window <= n; 1 <= maxCost <= 1000; 0 <= maxSetup <= 10^9; 0 <= maxRate <= 1000; 1 <= seed <= 2147483646.',
    'The tree can be 50000 levels deep, so a recursive search can overflow the stack. Trying every depot for every vertex is far too slow.',
  ].join(' '),
  edges: {
    direction: 'the two directions of an edge can cost differently',
    'zero-up': 'an upward cost of 0 is allowed',
    'zero-rate': 'a rate of 0 is allowed',
    'own-depot': 'a vertex may be served by its own depot',
    huge: '50000',
  },
  tests: [
    // Hand-derived expected values. Seed 1 draws: 48282 183136786 1153105965 949389933 700428874 419638497
    // 1304130194 332966427 854783580 1654880380 634121885 1613090155 ...
    // n = 1, maxSetup 100: setup(0) = 48282 mod 101 = 4, and the only depot serves its own vertex: f(0) = 4, h = 4.
    t('own-depot', [1, 1, 10, 100, 5, 1], 4),
    // n = 2: parent(1) = 0. down(1) = 1 + 183136786 mod 10 = 7, up(1) = 1153105965 mod 11 = 0.
    // setup(0) = 949389933 mod 1001 = 492, rate(0) = 700428874 mod 10 = 4; setup(1) = 419638497 mod 1001 = 278, rate(1) = 1304130194 mod 10 = 4.
    // f(0) = min(492, 278 + 4 * up(1)) = 278 (walking up is free); f(1) = min(278, 492 + 4 * down(1) = 520) = 278.
    // h = 278 * 1000003 + 278 = 278001112.
    t('zero-up', [2, 1, 10, 1000, 9, 1], 278001112),
    // n = 3 path, maxRate 0 makes every rate 0, so every depot serves every vertex at its setup price alone.
    // The setups are 367, 651, 397: f = 367, 367, 367. h = (367 * 1000003 + 367) * 1000003 + 367 mod 1000000007 = 566435757.
    t('zero-rate', [3, 1, 100, 1000, 0, 1], 566435757),
    // n = 3 path 0-1-2: down = 6, 5; up = 8, 3 (maxCost 10); setups 14, 77, 51; rates 7, 0, 5 (maxSetup 100, maxRate 9).
    // f(1) = min(77, 14 + 7 * down(1) = 56, 51 + 5 * up(2) = 66) = 56. f(2) = 51 (depot 0 would cost 14 + 7 * 11 = 91). f(0) = 14.
    // Read the other way round, f(1) would be 70, so the direction matters. h over 14, 56, 51 is 139902345.
    t('direction', [3, 1, 10, 100, 9, 1], 139902345),
    // n = 4, window 2: parents 0, 0, 1 for vertices 1..3 hang as 0-1, 1-2, 1-3. down = 4, 8, 8; up = 2, 4, 2;
    // setups 34, 55, 7, 46; rates 5, 0, 2, 4. Depot 2 serves vertex 0 at 7 + 2 * (4 + 2) = 19, vertex 1 at 7 + 2 * 4 = 15,
    // vertex 3 at 7 + 2 * (4 + 8) = 31 (cheaper than its own depot 46); vertex 2 uses its own depot at 7. f = 19, 15, 7, 31.
    t('direction', [4, 2, 10, 60, 5, 1], 608699631),
    t('huge', [46000, 1, 1000, 1000000000, 1000, 20260101]),
    t('huge', [45000, 2, 1000, 1000000000, 1000, 424242]),
    t('huge', [46000, 4, 5, 10000000, 20, 777]),
    t('huge', [44000, 20, 1000, 1000000000, 300, 31337]),
    t('huge', [46000, 46000, 1000, 1000000000, 1000, 99]),
    t('huge', [43000, 1, 3, 1000000, 10, 2024]),
    t('huge', [46000, 3, 1000, 2000000, 1000, 5150]),
    t('huge', [45000, 2, 40, 100000000, 700, 61803]),
    t('huge', [46000, 1, 1000, 1000000000, 0, 27182]),
    t('huge', [44000, 8, 200, 500000000, 1000, 14142]),
  ],
};
