import { t } from './_util.mjs';

export default {
  slug: 'capped-cover-profit',
  tier: {
    level: 5,
    human_minutes: 300,
    basis: 'Interval selection with a capacity that changes along the road is a min-cost flow, but not the textbook one: the capacity differs from block to block, so the reduction needs a supply or demand at every point where the capacity changes (a lower bound on the idle edge), negative costs for the offers, and shortest paths with potentials. Greedy by profit is wrong, and the exact search over subsets is exponential (30 offers already take several seconds, 60 take minutes). About 5 h for an expert who has seen the reduction before.',
  },
  tags: ['efficiency'],
  name: 'maxCappedProfit',
  signature: 'maxCappedProfit(m, n, blocks, maxCap, maxLen, maxProfit, seed) -> number',
  task: [
    'A road has m positions numbered 0..m-1. n offers each want a stretch of it, and the road has a capacity at every position. The capacities and the offers are built from a pseudo-random generator, so the input stays small.',
    'The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 for i = 0, 1, 2, ... (exact integer arithmetic; every product is below 2^47). Each draw returns the new x.',
    'Step 1: for b = 0..blocks-1, draw r and set capacity(b) = r mod (maxCap + 1). Block b holds the positions from floor(b * m / blocks) to floor((b + 1) * m / blocks) - 1, and every position of block b has the capacity capacity(b). The capacity can differ from block to block, and a capacity of 0 is allowed.',
    'Step 2: for i = 0..n-1, draw r1, r2, r3 in this order and set l = r1 mod m, r = min(m, l + 1 + (r2 mod maxLen)) and profit = 1 + (r3 mod maxProfit). Offer i covers the positions l, l+1, ..., r-1; the end r itself is not covered, so two offers that only touch at an end do not overlap. Several offers can be identical.',
    'Choose a set of offers (the empty set is allowed). At every position x, the number of chosen offers that cover x must be at most the capacity of x. A position with capacity 0 may not be covered by any chosen offer. The score of a choice is the sum of the profits of the chosen offers. Return the largest possible score.',
    'Because offers compete for capacity, it can be better to skip the most profitable offer, and an offer that covers a position with capacity 0 can never be chosen.',
    'Limits: 1 <= m <= 200000; 1 <= n <= 20000; 1 <= blocks <= min(m, 12); 0 <= maxCap <= 6; 1 <= maxLen <= m; 1 <= maxProfit <= 1000000; 1 <= seed <= 2147483646. The score is an exact integer below 2^53.',
    'The number of subsets of offers is far too large to try, and choosing the most profitable offers first is not always right.',
  ].join(' '),
  edges: {
    'half-open': 'the end r itself is not covered',
    'zero-capacity': 'a capacity of 0 is allowed',
    'trade-off': 'it can be better to skip the most profitable offer',
    varying: 'the capacity can differ from block to block',
    identical: 'several offers can be identical',
    huge: '200000',
  },
  tests: [
    // Hand-derived expected values; the offers and capacities come from the draws of each seed. Written as [l,r):profit.
    // m = 6, one block of capacity 1; offers [4,5):7, [4,5):7, [2,6):9, [0,4):6. The offer [2,6):9 blocks all the others, so taking it
    // gives 9. Better: [0,4):6 and one of the offers [4,5):7. They touch at 4 but do not overlap: 6 + 7 = 13.
    t('half-open', [6, 4, 1, 2, 4, 9, 2], 13),
    // m = 8, three blocks [0,2) [2,5) [5,8) with capacities 2, 1, 0; offers [2,3):4, [2,5):1, [3,4):3, [4,6):9, [5,8):1, [2,4):5.
    // The offers [4,6):9 and [5,8):1 cover positions with capacity 0, so they are out. In the block [2,5) of capacity 1:
    // [2,3):4 + [3,4):3 = 7 beats [2,4):5 and [2,5):1.
    t('zero-capacity', [8, 6, 3, 2, 4, 9, 6], 7),
    // m = 8, blocks [0,2) [2,5) [5,8) with capacities 0, 1, 1; offers [2,3):6, [0,4):2, [2,4):9, [3,4):4, [3,5):8, [1,3):1.
    // The offers [0,4):2 and [1,3):1 cover position 0 or 1, which have capacity 0, so they are out. The rest have capacity 1 on
    // positions 2..4. [2,4):9 is the most profitable, but it blocks all the others. [2,3):6 + [3,5):8 = 14 beats it,
    // and beats [2,3):6 + [3,4):4 = 10.
    t('trade-off', [8, 6, 3, 2, 4, 9, 10], 14),
    // m = 6, blocks [0,3) [3,6) with capacities 1, 2; offers [0,4):5, [5,6):8, [1,6):8, [4,6):8, [1,4):8.
    // Positions 0..2 hold one offer at a time, positions 3..5 two. [1,4):8 + [5,6):8 + [4,6):8 = 24 (position 5 is covered twice,
    // which the capacity 2 allows). Adding [0,4):5 would cover positions 1 and 2 twice, adding [1,6):8 would too: 24 is the best.
    t('varying', [6, 5, 2, 2, 5, 9, 95], 24),
    // m = 6, blocks [0,3) [3,6) with capacities 1, 1; offers [2,3):2, [2,3):3, [5,6):4, [5,6):2. Two pairs of identical stretches:
    // one offer of each pair fits, the better one: 3 + 4 = 7. (Taking the most profitable offers first is right here.)
    t('identical', [6, 4, 2, 2, 3, 9, 2], 7),
    t('huge', [200000, 15000, 6, 3, 5000, 1000000, 20260101]),
    t('huge', [200000, 16000, 5, 3, 20000, 1000000, 424242]),
    t('huge', [200000, 14000, 4, 3, 800, 100000, 777]),
    t('huge', [200000, 15000, 6, 2, 3000, 1000, 31337]),
    t('huge', [199999, 16000, 3, 3, 50000, 1000000, 99]),
    t('huge', [200000, 14000, 5, 3, 200, 999999, 2024]),
    t('huge', [150000, 15000, 6, 3, 8000, 500000, 5150]),
    t('huge', [200000, 16000, 6, 3, 1500, 1000000, 61803]),
    t('huge', [200000, 13000, 4, 3, 30000, 1000000, 27182]),
    t('huge', [200000, 15000, 5, 2, 10000, 777777, 14142]),
  ],
};
