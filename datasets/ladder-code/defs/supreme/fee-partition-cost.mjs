import { t } from './_util.mjs';

export default {
  slug: 'fee-partition-cost',
  tier: {
    level: 5,
    human_minutes: 180,
    basis: 'Needs two techniques together: a Lagrange (Aliens) search over a per-group penalty, and a Li Chao or convex hull trick for each inner DP. Ties in the penalty search and exact integer arithmetic near 10^15 are the usual traps; about 3 h for an expert who knows both ideas.',
  },
  tags: ['efficiency'],
  name: 'minPartitionCost',
  signature: 'minPartitionCost(n, k, maxA, zeroPct, fee, seed) -> number',
  task: [
    'A sequence a_1..a_n of non-negative integers is built from a pseudo-random generator, so the input stays small.',
    'The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 for i = 0, 1, 2, ... (exact integer arithmetic; every product is below 2^47).',
    'For each i = 1..n, in order, draw two numbers: u = the next x, then v = the next x after it (two draws per element, 2n draws in total).',
    'Then a_i = 0 when (u mod 100) < zeroPct, and a_i = 1 + (v mod maxA) otherwise.',
    'Split the sequence into exactly k groups of consecutive elements; every group must contain at least one element, and every element belongs to exactly one group.',
    'The cost of one group is the square of the sum of its elements, plus the fixed fee. The cost of a split is the sum of the costs of its k groups.',
    'Return the smallest possible cost of a split into exactly k groups, as a number.',
    'Limits: 1 <= k <= n <= 16000; 1 <= maxA <= 200; 0 <= zeroPct <= 100; 0 <= fee <= 10^9; 1 <= seed <= 2147483646.',
    'Every cost fits exactly in a double (below 2^53). When k = 1 the answer is the cost of the whole sequence as one group, and when k = n every element is its own group.',
    'Many elements can be zero, and then many different splits have the same cost.',
    'The inputs are far too large for a quadratic dynamic programme.',
  ].join(' '),
  edges: {
    exactly: 'exactly k groups',
    fee: 'plus the fixed fee',
    zeros: 'many elements can be zero',
    'k-one': 'when k = 1',
    'k-n': 'k = n',
    huge: 'n <= 16000',
  },
  tests: [
    // Hand-derived expected values. Seed 1 with zeroPct 70 and maxA 10 gives the sequence [7, 0, 8, 8]
    // (draws 48282 183136786 | 1153105965 949389933 | 700428874 419638497 | 1304130194 332966427:
    // u mod 100 = 82, 65, 74, 94, so only the second element is zero; v mod 10 = 6, 9, 7, 7 give 7, 8, 8).
    // Exactly 2 groups: [7][0,8,8] = 305, [7,0][8,8] = 305, [7,0,8][8] = 289 -> 289 + 2 * 3 = 295.
    t('exactly', [4, 2, 10, 70, 3, 1], 295),
    // maxA 1 and zeroPct 0 make every element 1. Two groups of 3: 9 + 9 = 18, plus 2 fees of 10.
    t('fee', [6, 2, 1, 0, 10, 1], 38),
    // One group: (7 + 0 + 8 + 8)^2 = 529, plus the fee 5.
    t('k-one', [4, 1, 10, 70, 5, 1], 534),
    // Every element alone: 49 + 0 + 64 + 64 = 177, plus 4 fees of 2.
    t('k-n', [4, 4, 10, 70, 2, 1], 185),
    // Three groups: [7][0][8,8] = 305, [7][0,8][8] = 177, [7,0][8][8] = 177 (a tie) -> 177 + 3 = 180.
    t('zeros', [4, 3, 10, 70, 1, 1], 180),
    t('huge', [13000, 700, 200, 20, 1000, 20260101]),
    t('huge', [12000, 6000, 200, 80, 3, 424242]),
    t('huge', [12000, 11000, 200, 5, 1000000000, 777]),
    // Few groups, but not so few that a quadratic DP per group finishes: the naive O(k n^2) needs
    // about k n^2 / 2 steps, and this machine does about 2.2e8 of them per CPU second (CI about 2x
    // faster). Each huge test keeps that count at 2e10 or more: 90 s here, far over the 2 s limit.
    t('huge', [13000, 250, 200, 50, 0, 31337]),
    t('huge', [12000, 4000, 1, 70, 20, 99]),
    t('huge', [8000, 8000, 200, 0, 123, 5]),
    t('huge', [12000, 300, 200, 10, 500000, 2468]),
    t('huge', [12000, 1500, 50, 95, 7, 1357]),
    t('huge', [10000, 400, 5, 0, 0, 86420]),
    t('huge', [13000, 2500, 120, 30, 2000000, 97531]),
  ],
};
