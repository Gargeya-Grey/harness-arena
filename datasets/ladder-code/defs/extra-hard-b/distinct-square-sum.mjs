import { t } from './_util.mjs';

export default {
  slug: 'distinct-square-sum',
  tier: {
    level: 4,
    human_minutes: 75,
    basis: 'The reference is about 55 lines: a closed form for the sum of squares over all subarrays (a diagonal term and a pair term whose left bound is max(p_i, p_j)), prefix sums for one part of the pair term and a Fenwick tree for the other; the derivation is where an expert spends an hour, the code is short.',
  },
  tags: ['efficiency', 'counting'],
  name: 'distinctSquareSum',
  signature: 'distinctSquareSum(n, v, seed) -> number',
  task: [
    'A sequence a_1, ..., a_n is built from a pseudo-random generator, so the input stays small.',
    'The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 for i = 0, 1, 2, ... (exact integer arithmetic; every product is below 2^47). The value a_i (i = 1..n) is x_i mod v, so every value is an integer from 0 to v - 1.',
    'Every value x has a weight w(x) = (x mod 7) + 1.',
    'For a subarray a_l, ..., a_r (1 <= l <= r <= n), let D(l, r) be the sum of w(x) over the distinct values x that occur in the subarray. A value that occurs several times in the subarray counts once.',
    'Return the sum of D(l, r) * D(l, r) over all pairs 1 <= l <= r <= n, modulo 1000000007, as a number.',
    'Limits: 1 <= n <= 200000; 1 <= v <= 200000; 1 <= seed <= 2147483646.',
    'The inputs are too large for any method that visits every pair of start and end positions.',
    'Execution allowance: 2000 ms of process CPU time per test, including loading the solution and calling it, and 30000 ms of process CPU time for the whole case. Model-generation time is measured separately and is not part of this allowance.',
  ].join(' '),
  edges: {
    weight: 'w(x) = (x mod 7) + 1',
    distinct: 'A value that occurs several times in the subarray counts once',
    'single-element': 'Limits: 1 <= n',
    modulus: 'modulo 1000000007',
    huge: '200000',
  },
  tests: [
    // seed 1 gives x = 48282, 183136786, 1153105965, 949389933, 700428874; with v = 2 the values are 0, 0, 1, 1, 0; w(0) = 1 and w(1) = 2.
    // D(l, r) by l: l=1: 1 1 3 3 3 (squares 1 1 9 9 9 = 29); l=2: 1 3 3 3 (28); l=3: 2 2 3 (4 4 9 = 17); l=4: 2 3 (4 9 = 13); l=5: 1 (1). Total 88.
    t('weight', [5, 2, 1], 88),
    // v = 3: the values are 48282 mod 3 = 0, 183136786 mod 3 = 1, 1153105965 mod 3 = 0. Subarrays: [0] 1, [1] 2, [0] 1, [0,1] 3, [1,0] 3, [0,1,0] 3: 1 + 4 + 1 + 9 + 9 + 9 = 33.
    t('distinct', [3, 3, 1], 33),
    // One element: 48282 mod 1000 = 282, 282 mod 7 = 2, w = 3, 3 * 3 = 9.
    t('single-element', [1, 1000, 1], 9),
    t('modulus', [2000, 500, 99]),
    t('huge', [150000, 50000, 20260101]),
    t('huge', [200000, 200000, 7]),
    t('huge', [160000, 30000, 424242]),
    t('huge', [180000, 100000, 8675309]),
    t('huge', [150000, 5000, 99]),
    t('huge', [170000, 20000, 31]),
    t('huge', [200000, 120000, 41]),
    t('huge', [155000, 80000, 314159]),
    t('huge', [190000, 60000, 11]),
    t('huge', [165000, 1000, 13]),
  ],
};
