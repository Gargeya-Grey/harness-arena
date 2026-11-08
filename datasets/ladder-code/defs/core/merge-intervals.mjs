import { t } from './_util.mjs';

export default {
  slug: 'merge-intervals',
  tier: { level: 2, human_minutes: 4, basis: 'estimated from the reference (sort, then one pass, 10 lines); the touching rule is the only trap', origin: 'coding-merge-intervals' },
  name: 'mergeIntervals',
  signature: 'mergeIntervals(intervals) -> array',
  tags: ['arrays', 'sorting'],
  task: 'Given an array of [start, end] pairs in any order, merge every pair that overlaps or touches (end equal to the next start) and return the merged pairs sorted by start.',
  edges: {
    overlap: 'merge every pair that overlaps',
    touching: 'or touches (end equal to the next start)',
    unsorted: 'in any order',
  },
  tests: [
    t('overlap', [[[1, 3], [2, 6], [8, 10], [15, 18]]], [[1, 6], [8, 10], [15, 18]]),
    t('touching', [[[1, 4], [4, 5]]], [[1, 5]]),
    t('unsorted', [[[5, 6], [1, 2]]], [[1, 2], [5, 6]]),
    t('basic', [[]], []),
    t('overlap', [[[1, 10], [2, 3]]], [[1, 10]]),
    t('unsorted', [[[2, 3], [1, 10], [4, 5]]]),
    t('touching', [[[3, 4], [1, 3], [4, 4]]]),
    t('basic', [[[1, 2], [3, 4]]]),
    t('overlap', [[[0, 0], [0, 0]]]),
    t('unsorted', [[[9, 12], [1, 3], [11, 15], [3, 5], [20, 21]]]),
  ],
};
