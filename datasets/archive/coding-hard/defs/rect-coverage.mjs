import { t, rng, randInt } from './_util.mjs';

const rand = rng(777);
function randomRects(count, span) {
  return Array.from({ length: count }, () => [randInt(rand, -span, span), randInt(rand, -span, span), randInt(rand, -span, span), randInt(rand, -span, span)]);
}

const HUGE = [-1000000000, -1000000000, 1000000000, 1000000000];

export default {
  name: 'areaCoveredAtLeast',
  signature: 'areaCoveredAtLeast(rects, k) -> string',
  kind: 'geometry',
  task: [
    'Each element of rects is [x1, y1, x2, y2], the corners of an axis-aligned rectangle with integer coordinates whose absolute value is at most 10^9; the two corners can come in any order (x1 can be larger than x2, and y1 can be larger than y2).',
    'rects has at most 40 elements.',
    'A rectangle with zero width or zero height has no area and counts for nothing.',
    'Return the total area of the region that is covered by at least k of the rectangles (area is counted once, however many rectangles cover it), as a decimal string.',
    'k is an integer from 1 to 40; if k is larger than the number of rectangles the area is 0.',
    'The area can be larger than 2^53, so return it exactly.',
    'Rectangles that only share a border cover no common area.',
  ].join(' '),
  edges: {
    'any-order': 'can come in any order',
    'zero-area': 'zero width or zero height',
    'counted-once': 'counted once',
    'k-too-large': 'if k is larger than the number of rectangles',
    exact: 'larger than 2^53',
    border: 'only share a border',
  },
  tests: [
    t('basic', [[[0, 0, 2, 2]], 1], '4'),
    t('counted-once', [[[0, 0, 2, 2], [1, 1, 3, 3]], 1], '7'),
    t('basic', [[[0, 0, 2, 2], [1, 1, 3, 3]], 2], '1'),
    t('k-too-large', [[[0, 0, 2, 2], [1, 1, 3, 3]], 3], '0'),
    t('any-order', [[[2, 2, 0, 0]], 1], '4'),
    t('any-order', [[[3, 3, -3, -3], [0, 0, 5, -5]], 2], '9'),
    t('zero-area', [[[0, 0, 0, 5], [0, 0, 5, 0]], 1], '0'),
    t('counted-once', [[[0, 0, 2, 2], [0, 0, 2, 2]], 2], '4'),
    t('border', [[[0, 0, 1, 1], [1, 0, 2, 1]], 2], '0'),
    t('border', [[[0, 0, 1, 1], [1, 0, 2, 1]], 1], '2'),
    t('exact', [[HUGE], 1], '4000000000000000000'),
    t('exact', [[HUGE, [-999999999, -999999999, 999999999, 999999999]], 2]),
    t('basic', [[], 1], '0'),
    t('basic', [[[0, 0, 10, 10], [2, 2, 8, 8], [4, 4, 6, 6]], 2], '36'),
    t('basic', [[[0, 0, 10, 10], [2, 2, 8, 8], [4, 4, 6, 6]], 3], '4'),
    t('basic', [[[0, 2, 6, 4], [2, 0, 4, 6]], 2], '4'),
    t('counted-once', [[[0, 0, 3, 3], [1, 1, 2, 2], [2, 2, 1, 1]], 3], '1'),
    t('basic', [randomRects(20, 30), 3]),
    t('exact', [randomRects(40, 1000000000), 5]),
    t('exact', [randomRects(40, 1000000000), 1]),
  ],
};
