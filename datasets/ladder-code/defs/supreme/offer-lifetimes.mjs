import { t } from './_util.mjs';

export default {
  slug: 'offer-lifetimes',
  tier: {
    level: 5,
    human_minutes: 200,
    basis: 'Offline processing: a segment tree over time holds each offer on O(log q) nodes, and a Li Chao tree with rollback answers the minimum line at a point during a depth-first walk. Two data structures that must be combined with exact rollback; about 3.5 h for an expert.',
  },
  tags: ['efficiency'],
  name: 'offerChecksum',
  signature: 'offerChecksum(n, q, horizon, maxLen, xRange, seed) -> number',
  task: [
    'A shop lists n offers. Offer i is active during a time interval and sells at a price that is a linear function of the amount x: price = slope * x + base. A list of q price queries is asked. Everything is built from a pseudo-random generator, so the input stays small.',
    'The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 for i = 0, 1, 2, ... (exact integer arithmetic; every product is below 2^47). Each draw returns the new x.',
    'Step 1: for each offer i = 0..n-1 in order, draw four numbers a, b, c, d and set start = a mod horizon, length = 1 + (b mod maxLen), end = min(horizon, start + length), slope = (c mod 2001) - 1000, base = d mod 1000000001.',
    'The offer is active at time t when start <= t and t < end. The end time itself is not included (a half-open interval). Slopes can be negative, so a price can be negative.',
    'Step 2: for each query j = 0..q-1 in order, draw two numbers a, b and set time = a mod horizon and amount = b mod (xRange + 1).',
    'The answer to a query is the smallest price slope * amount + base over all offers that are active at the query time. Several offers can be active at once, and many queries ask about the same time. When no offer is active at the query time, the answer is the number 4000000000 (no real price is that high).',
    'Fold the answers, in the order of the queries, into a checksum: h starts at 0; for each answer a, set h = (h * 1000003 + ((a mod 1000000007) + 1000000007) mod 1000000007) mod 1000000007, where a mod 1000000007 keeps the sign of a, as the % operator does in JavaScript. Return h as a number.',
    'Limits: 1 <= n, q <= 24000; 1 <= horizon <= 10^9; 1 <= maxLen <= 10^9; 0 <= xRange <= 10^6; 1 <= seed <= 2147483646. All prices fit exactly in a double.',
    'The inputs are too large for checking every offer for every query.',
  ].join(' '),
  edges: {
    'end-excluded': 'the end time itself is not included',
    'none-active': 'when no offer is active',
    'negative-price': 'a price can be negative',
    'same-time': 'many queries ask about the same time',
    huge: '24000',
  },
  tests: [
    // Hand-derived expected values; the offers and queries come from the draws of each seed.
    // Seed 1, horizon 6, maxLen 3, xRange 10: offers [0,2) price 701x + 949389933 and [4,5) price -545x + 332966427;
    // queries (time 0, x 10), (time 5, x 6), (time 0, x 4). Time 5 is the end of the second offer, which is not
    // included, so the answers are 949396943, 4000000000, 949392737. The checksum fold gives 305535925.
    t('end-excluded', [2, 3, 6, 3, 10, 1], 305535925),
    // Seed 4: offers [3,5) and [4,5); queries at times 2, 2, 1 find no offer, so all three answers are 4000000000
    // (that is 999999979 mod 1000000007), and the fold gives 804195643.
    t('none-active', [2, 3, 6, 3, 10, 4], 804195643),
    // Seed 1, horizon 2, maxLen 2: offers [0,1) 701x + 949389933 and [0,2) -545x + 332966427; queries (0,10), (1,6), (0,4).
    // Two offers are active at time 0 and the cheaper one wins: 332960977; at time 1 only the second offer is active
    // (the first ended at 1): 332963157; then 332964247. The fold gives 604364697.
    t('same-time', [2, 3, 2, 2, 10, 1], 604364697),
    // Seed 5, horizon 1 (every offer is active at time 0), xRange 10^6: offers -138x + 18337893 and 517x + 604348799;
    // queries x = 151164 and x = 833558 give -2522739 and -96693111. The fold gives 156756333.
    t('negative-price', [2, 2, 1, 1, 1000000, 5], 156756333),
    t('huge', [24000, 24000, 1000000000, 300000000, 1000000, 20260101]),
    t('huge', [24000, 24000, 100000, 50000, 1000000, 424242]),
    t('huge', [24000, 24000, 1000, 1000, 1000000, 777]),
    t('huge', [20000, 24000, 1000000000, 1000, 1000000, 31337]),
    t('huge', [24000, 22000, 50, 20, 500000, 99]),
    t('huge', [24000, 24000, 1000000, 1, 1000000, 5150]),
    t('huge', [24000, 24000, 10, 10, 1000000, 2024]),
    t('huge', [22000, 24000, 1000000000, 1000000000, 0, 61803]),
    t('huge', [24000, 22000, 5000, 2500, 1000, 27182]),
    t('huge', [24000, 24000, 1000000000, 50000000, 1000000, 14142]),
  ],
};
