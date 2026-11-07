import { t } from './_util.mjs';

export default {
  slug: 'tree-path-ops',
  tier: {
    level: 5,
    human_minutes: 150,
    basis: 'Heavy-light decomposition with a lazy segment tree that keeps both sum and max, on trees up to depth 40000 (so no recursive DFS). The reference is about 110 lines; an expert needs about 2.5 h to write and debug it from scratch.',
  },
  tags: ['efficiency'],
  name: 'treePathChecksum',
  signature: 'treePathChecksum(n, q, window, bias, seed) -> number',
  task: [
    'A rooted tree with n vertices numbered 0..n-1 (vertex 0 is the root), integer values on the vertices, and a list of q operations are all built from a pseudo-random generator, so the input stays small.',
    'The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 for i = 0, 1, 2, ... (exact integer arithmetic; every product is below 2^47). Each draw returns the new x.',
    'Step 1: for i = 1..n-1, draw r and set parent(i) = i - 1 - (r mod min(i, window)). So parent(i) < i. With window = 1 the tree is a single path 0-1-2-...-(n-1); a larger window gives a bushier tree.',
    'Step 2: for i = 0..n-1, draw r and set value(i) = (r mod 1000) - bias. Values can be negative.',
    'Step 3: for each of the q operations, draw four numbers r1, r2, r3, r4 in this order and set kind = r1 mod 3, u = r2 mod n, w = r3 mod n, d = (r4 mod 201) - 100. The vertices u and w may be the same vertex.',
    'The path between u and w is the unique shortest route of vertices in the tree, and it includes both endpoints and every vertex between them. If u = w the path is that one vertex.',
    'Kind 0 adds d to the value of every vertex on the path. Kind 1 is a query: its answer is the sum of the values on the path. Kind 2 is a query: its answer is the largest value on the path.',
    'The operations run in the order they were drawn, and a query sees all earlier additions.',
    'Answers can be negative. Fold the answers of the queries (kind 1 and kind 2 only, in order) into a checksum: h starts at 0; for each answer a, set h = (h * 1000003 + ((a mod 1000000007) + 1000000007) mod 1000000007) mod 1000000007, where a mod 1000000007 keeps the sign of a, as the % operator does in JavaScript. Return h as a number.',
    'Limits: 1 <= n, q <= 40000; 1 <= window <= n; 0 <= bias <= 1000; 1 <= seed <= 2147483646. All sums stay below 2^53.',
    'The tree can be 40000 levels deep, so walking the path one vertex at a time is too slow, and a recursive depth-first search can overflow the stack.',
  ].join(' '),
  edges: {
    'single-vertex': 'u and w may be the same vertex',
    negative: 'values can be negative',
    'path-graph': 'a single path',
    'later-sees-earlier': 'a query sees all earlier additions',
    huge: '40000',
  },
  tests: [
    // Hand-derived expected values; seed 1 draws: 48282 183136786 1153105965 949389933 700428874 419638497
    // 1304130194 332966427 854783580 1654880380 634121885 1613090155 2012799090 1222232180 551326760 1476678347 1463276824.
    // n = 1, bias 0: value(0) = 282. Operation 1 has kind 183136786 mod 3 = 1 (sum): 282. Operation 2 has kind 0
    // and d = 854783580 mod 201 - 100 = 26: the value is 308. Operation 3 has kind 1: 308.
    // Fold: 282 * 1000003 + 308 = 282001154.
    t('single-vertex', [1, 3, 1, 0, 1], 282001154),
    // Same, bias 500: value(0) = -218, answers -218 and -192; fold: -218 * 1000003 - 192 = -218000846,
    // which is 781999161 modulo 1000000007.
    t('negative', [1, 3, 1, 500, 1], 781999161),
    // n = 3, window 1: parents 0, 1; values -35, -67, -126 (bias 1000). Operation 1 adds 26 on the path 2..0 -> -9, -41, -100.
    // Operation 2 is the sum on 2..1: -141. Operation 3 is the maximum on vertex 2: -100.
    // Fold: -141 * 1000003 - 100 = -141000523, which is 858999484 modulo 1000000007.
    t('path-graph', [3, 3, 1, 1000, 1], 858999484),
    // n = 4, window 2: parents 0, 1, 1 (draws 48282, 183136786, 1153105965 give offsets 0, 0, 1); values 433, 374, -3, -306 (bias 500).
    // Operation 1 adds -50 at vertex 0 (u = w = 0): 383. Operation 2 is the sum on 2..0: -3 + 374 + 383 = 754.
    // Operation 3 is the maximum on 0..2: max(383, 374, -3) = 383. Fold: 754 * 1000003 + 383 = 754002645.
    t('later-sees-earlier', [4, 3, 2, 500, 1], 754002645),
    t('huge', [40000, 40000, 1, 1000, 20260101]),
    t('huge', [40000, 40000, 2, 500, 424242]),
    t('huge', [40000, 40000, 3, 0, 777]),
    t('huge', [40000, 40000, 4, 1000, 31337]),
    t('huge', [30000, 40000, 1, 250, 99]),
    t('huge', [40000, 30000, 2, 1000, 2024]),
    t('huge', [24000, 40000, 1, 0, 5150]),
    t('huge', [40000, 24000, 2, 800, 61803]),
    t('huge', [36000, 36000, 3, 1000, 27182]),
    t('huge', [40000, 32000, 3, 600, 14142]),
  ],
};
