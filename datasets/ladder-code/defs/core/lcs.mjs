import { t } from './_util.mjs';

export default {
  slug: 'lcs',
  tier: { level: 2, human_minutes: 6, basis: 'estimated from the reference (a table, 8 lines); the recurrence is known, the work is writing and checking it', origin: 'coding-lcs' },
  name: 'lcsLength',
  signature: 'lcsLength(a, b) -> number',
  tags: ['dynamic-programming'],
  task: 'Return the length of the longest common subsequence of strings a and b (characters in the same order, not necessarily next to each other).',
  edges: {
    'not-adjacent': 'not necessarily next to each other',
    order: 'characters in the same order',
  },
  tests: [
    t('not-adjacent', ['ABCBDAB', 'BDCABA'], 4),
    t('basic', ['', 'abc'], 0),
    t('basic', ['abc', 'abc'], 3),
    t('basic', ['abc', 'def'], 0),
    t('not-adjacent', ['AGGTAB', 'GXTXAYB'], 4),
    t('order', ['abc', 'cba']),
    t('order', ['abcdef', 'fedcba']),
    t('basic', ['aaaa', 'aa']),
    t('not-adjacent', ['axbxcxdxexf', 'abcdef']),
    t('basic', ['the quick brown fox jumps', 'a lazy dog quickly jumped over']),
  ],
};
