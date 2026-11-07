import { t } from './_util.mjs';

export default {
  slug: 'primes',
  tier: { level: 1, human_minutes: 2, basis: 'estimated from the reference (a sieve or trial division, about 6 lines) plus the small-n rule', origin: 'coding-primes' },
  name: 'primesUpTo',
  signature: 'primesUpTo(n) -> number[]',
  tags: ['math'],
  task: 'Return every prime number less than or equal to n, in increasing order. For n below 2, return an empty array.',
  edges: {
    'below-two': 'For n below 2, return an empty array',
    inclusive: 'less than or equal to n',
    order: 'in increasing order',
  },
  tests: [
    t('basic', [10], [2, 3, 5, 7]),
    t('below-two', [1], []),
    t('inclusive', [2], [2]),
    t('order', [30], [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]),
    t('below-two', [0], []),
    t('below-two', [-7], []),
    t('inclusive', [13]),
    t('inclusive', [97]),
    t('basic', [200]),
  ],
};
