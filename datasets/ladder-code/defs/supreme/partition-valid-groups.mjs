import { t } from './_util.mjs';

export default {
  slug: 'partition-valid-groups',
  tier: {
    level: 5,
    human_minutes: 180,
    basis: 'Counting set partitions into k valid groups for n up to 16 needs ranked (by group size) subset sums plus inclusion-exclusion over the union, and a truncated power of a polynomial per subset, all modulo a prime. A bitmask DP over submasks is too slow, so the expert has to know or derive the ranked transform; about 3 h.',
  },
  tags: ['efficiency'],
  name: 'countValidPartitions',
  signature: 'countValidPartitions(n, k, d, cap, seed) -> number',
  task: [
    'There are n items numbered 0..n-1. Their weights come from a pseudo-random generator, so the input stays small.',
    'The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 for i = 0, 1, 2, ... (exact integer arithmetic; every product is below 2^47). For i = 0..n-1, in order, draw once and set weight(i) = x mod 1000. A weight of 0 is allowed.',
    'A group is a non-empty set of items. A group is valid when the sum of the weights of its items is a multiple of d, and the group has at most cap items.',
    'A partition splits all n items into groups so that every item is in exactly one group. The order of the groups does not matter, and the items are told apart by their numbers, so the partition {0,1},{2} differs from {0,2},{1}.',
    'Count the partitions into exactly k groups in which every group is valid. Return the count modulo 67108859 (a prime), as a number in the range 0..67108858. The count itself can be far larger than the modulus. If no such partition exists, return 0.',
    'Limits: 1 <= n <= 16; 1 <= k <= n; 1 <= d <= 12; 1 <= cap <= n; 1 <= seed <= 2147483646. All intermediate products of two numbers below the modulus are below 2^52, so a double can hold them exactly.',
    'When d = 1 every group of at most cap items is valid. When k = n every item must be a group on its own, and when k = 1 the whole set must be one valid group.',
    'The number of partitions of 16 items is about 10^10, and a dynamic programme over all pairs of a set and its subsets is also too slow for the largest inputs.',
  ].join(' '),
  edges: {
    unordered: 'the order of the groups does not matter',
    cap: 'at most cap items',
    'zero-weight': 'a weight of 0 is allowed',
    'd-one': 'when d = 1',
    'k-n': 'when k = n',
    huge: 'n <= 16',
  },
  tests: [
    // Hand-derived expected values. With d = 1 every group is valid, so only the cap matters.
    // 3 items in 2 groups: {0,1}{2}, {0,2}{1}, {1,2}{0} -> 3.
    t('unordered', [3, 2, 1, 3, 1], 3),
    // 5 items in 2 groups of at most 3: only sizes 2 and 3 fit, C(5,2) = 10 ways to pick the pair.
    t('cap', [5, 2, 1, 3, 1], 10),
    // 5 items in 3 groups with no limit: the Stirling number S(5,3) = 25.
    t('d-one', [5, 3, 1, 5, 1], 25),
    // Seed 59 gives the weights [0, 603, 708, 235] (draws 2848000, 36854603, 892081708, ...). The first three are
    // multiples of 3, so every item alone is valid and k = n = 3 has exactly one partition.
    t('k-n', [3, 3, 3, 3, 59], 1),
    // Same weights, d = 2, k = 2, cap 4: items 1 (603) and 3 (235) are odd, so they must share a group.
    // Items 0 (weight 0) and 2 (708) go to either side, but not both to the group of 1 and 3 (the other group
    // would be empty): 4 - 1 = 3 partitions.
    t('zero-weight', [4, 2, 2, 4, 59], 3),
    t('huge', [15, 6, 1, 15, 11]),
    t('huge', [16, 8, 1, 16, 13]),
    t('huge', [16, 6, 3, 16, 16]),
    t('huge', [15, 7, 2, 9, 15]),
    t('huge', [16, 10, 2, 5, 16]),
    t('huge', [15, 8, 1, 15, 17]),
    t('huge', [16, 12, 4, 16, 142]),
    t('huge', [16, 7, 5, 10, 19]),
    t('huge', [15, 9, 2, 15, 20]),
    t('huge', [16, 5, 2, 8, 23]),
  ],
};
